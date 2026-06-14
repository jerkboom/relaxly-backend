const socketManager = require('../utils/socketManager');
const asyncHandler = require('express-async-handler');
const cache = require('../utils/cache');

const Booking = require('../models/Booking');
const Room = require('../models/Room');
const Hostel = require('../models/Hostel');
const User = require('../models/User');
const PlatformSettings = require('../models/PlatformSettings');
const sendEmail = require('../utils/sendEmail');
const { calculatePaymentBreakdown } = require('../utils/paymentCalculator');
const {
  findActiveStudentRoomBooking,
  logLifecycleEvent,
  syncHostelAvailability,
  restoreRoomBed,
} = require('../utils/bookingLifecycle');

const {
  createNotification,
} = require('../services/notificationService');

const { sendSuccess, sendError } = require('../utils/responseHandler');
const { logOwnerActivity } = require('../utils/ownerActivityLogger');

const crypto = require('crypto');

/**
 * Generate a unique booking code
 */
const generateBookingCode = () => {
  return `BK-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
};

/* =========================================
   CREATE BOOKING
========================================= */
const createBooking =
  asyncHandler(async (req, res) => {
    const tStart = Date.now();
    
    // 1. INPUT NORMALIZATION
    const roomId = req.body.room || req.body.roomId || req.body.room_id || req.body.id || req.body._id;
    const checkInDate = req.body.checkInDate || req.body.check_in_date || req.body.date || req.body.checkIn || new Date().toISOString();
    const studentId = req.user.id;
    const studentUser = await User.findById(studentId).populate('university', 'name').lean();
    const studentGender = req.user.gender;

    if (!roomId) return sendError(res, 'Room ID required.', 400);
    if (!studentGender) return sendError(res, 'Gender missing.', 400);

    // 2. FAST PATH: 20-DAY COOLDOWN & DUPLICATE CHECK
    const tCheckStart = Date.now();
    const cooldownDate = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000); // 20 days ago

    const existingBooking = await Booking.findOne({
      student: studentId,
      room: roomId,
      bookingStatus: { $in: ['pending', 'approved'] },
      createdAt: { $gte: cooldownDate }
    }).select('_id paymentStatus').lean();

    if (existingBooking) {
      // If payment is pending, allow them to resume the flow
      if (existingBooking.paymentStatus === 'pending') {
        const populatedExisting = await Booking.findById(existingBooking._id)
          .populate('room')
          .populate({ path: 'hostel', populate: { path: 'owner', select: 'name email phone' } })
          .populate('student', 'name email phone gender')
          .lean();

        return sendSuccess(res, {
          booking: populatedExisting,
          ...populatedExisting,
          bookingId: populatedExisting._id,
        }, 'Existing pending booking found. Please complete your payment.');
      }
      
      // Otherwise, block the duplicate booking
      return sendError(res, 'You have already booked this room within the last 20 days.', 400);
    }
    const dCheck = Date.now() - tCheckStart;

    // 3. CACHE/FETCH DATA
    const tDataStart = Date.now();
    const settings = cache.get('platform_settings') || await PlatformSettings.getSettings().then(s => { cache.set('platform_settings', s, 1800); return s; });
    
    const roomMetaCacheKey = `room_meta_${roomId}`;
    let roomData = cache.get(roomMetaCacheKey);
    if (!roomData) {
      roomData = await Room.findById(roomId)
        .populate({ path: 'hostel', populate: { path: 'owner', select: 'name email phone commissionRate' } })
        .lean();
      if (!roomData) return sendError(res, `Room not found.`, 404);
      cache.set(roomMetaCacheKey, roomData, 300);
    }
    const dData = Date.now() - tDataStart;

    // 4. PRE-CALCULATION (Outside Transaction)
    const normalizedStudentGender = String(studentGender).toLowerCase();
    const normalizedAllocation = String(roomData.genderAllocation || 'Mixed').toLowerCase();
    if (normalizedAllocation !== 'mixed' && normalizedStudentGender !== normalizedAllocation) {
      return sendError(res, `Gender mismatch.`, 400);
    }

    const updateField = normalizedStudentGender === 'male' ? 'maleAvailableBeds' : 'femaleAvailableBeds';
    const ownerCommissionRate = roomData.hostel?.owner?.commissionRate ?? settings.commissionPercent ?? settings.commissionRate;
    
    // Support Global Room Price Adjustment
    const basePrice = roomData.basePrice || roomData.price;
    const platformAdjustment = roomData.platformAdjustment ?? (settings.roomTypeAdjustments?.[roomData.occupancyStyle] || 0);

    const breakdown = calculatePaymentBreakdown(
      basePrice, 
      platformAdjustment, 
      ownerCommissionRate, 
      settings.serviceFeePercent || 0
    );

    const expiresAt = new Date(Date.now() + settings.bookingExpirationMinutes * 60000);
    const bookingCode = generateBookingCode();

    // 5. MINIMAL TRANSACTIONAL WRITE
    const tTxStart = Date.now();
    const session = await Room.startSession();
    try {
      session.startTransaction();

      // Determine if this specific booking will take the last available bed
      const isSellingOut = (roomData.availableBeds - 1) <= 0;

      // Build a standard, lightning-fast MongoDB update object
      const updatePayload = {
        $inc: { 
          [updateField]: -1, 
          availableBeds: -1 
        }
      };

      // If it's the last bed, flip the status in the exact same atomic step
      if (isSellingOut) {
        updatePayload.$set = { roomStatus: 'unavailable' };
      }

      const reservedRoom = await Room.findOneAndUpdate(
        { _id: roomId, [updateField]: { $gt: 0 }, roomStatus: 'available' },
        updatePayload,
        { new: true, session, lean: true } // Removed the array, using standard object!
      );

      if (!reservedRoom) throw new Error('Sold out or room unavailable.');

      const [newBooking] = await Booking.create([{
        student: studentId,
        history: [{ event: 'BOOKING_CREATED', details: 'Student initiated booking request', actor: studentId }],
        room: roomId,
        hostel: roomData.hostel._id,
        bookingCode,
        amount: breakdown.totalPaid,
        ...breakdown,
        checkInDate,
        expiresAt,
        studentPhone: studentUser.phone,
        studentIdCard: studentUser.studentId,
        studentUniversity: studentUser.customUniversity || (studentUser.university ? studentUser.university.name : studentUser.schoolName),
        refundPolicyAccepted: true,
        refundPolicyAcceptedAt: new Date(),
      }], { session });

      await session.commitTransaction();
      session.endSession();
      const dTx = Date.now() - tTxStart;

      // 6. RESPONSE SYNTHESIS (Zero-Query Finalization)
      const tRespStart = Date.now();
      const bookingObj = newBooking.toObject();
      
      const responseData = {
        success: true,
        message: 'Booking created successfully',
        booking: {
          ...bookingObj,
          room: roomData, // Already in memory
          hostel: roomData.hostel, // Already in memory
          student: {
            _id: req.user._id,
            name: req.user.name,
            email: req.user.email,
            phone: req.user.phone,
            gender: req.user.gender
          }
        }
      };
      
      const finalResponse = {
        ...responseData,
        ...responseData.booking,
        bookingId: responseData.booking._id,
        totalAmount: responseData.booking.totalPaid,
        data: responseData.booking
      };
      const dResp = Date.now() - tRespStart;

      // 7. BACKGROUND PROCESSES
      setImmediate(() => {
        syncHostelAvailability(roomData.hostel._id).catch(() => {});
        
        // Update cache in-memory to prevent immediate DB hit on next request
        if (roomData) {
          const nextAvailableBeds = Math.max(0, roomData.availableBeds - 1);
          const updatedRoomData = {
            ...roomData,
            [updateField]: Math.max(0, roomData[updateField] - 1),
            availableBeds: nextAvailableBeds,
            roomStatus: nextAvailableBeds === 0 ? 'unavailable' : roomData.roomStatus
          };
          cache.set(roomMetaCacheKey, updatedRoomData, 300);
        }

        const totalDuration = Date.now() - tStart;
        console.log(`BOOKING_PERF: Total=${totalDuration}ms | Check=${dCheck}ms | Data=${dData}ms | Tx=${dTx}ms | Resp=${dResp}ms`);
        logLifecycleEvent('booking_created', { bookingId: newBooking._id, duration: totalDuration });
      });

      return res.status(201).json(finalResponse);

    } catch (error) {
      if (session.inTransaction()) await session.abortTransaction();
      session.endSession();
      console.error('BOOKING_ERROR:', error.message);
      return sendError(res, error.message || 'Booking failed.', 400);
    }
  });

/* =========================================
   GET MY BOOKINGS
========================================= */
const getMyBookings =
  asyncHandler(async (req, res) => {
    const bookings =
      await Booking.find({
        student: req.user.id,
      })
        .populate({
          path: 'room',
          select:
            'roomType price images',
        })
        .populate({
          path: 'hostel',
          populate: {
            path: 'owner',
            select:
              'name email phone whatsapp profileImage',
          },
        })
        .sort({
          createdAt: -1,
        })
        .lean();

    // ENRICH WITH GATED HOST CONTACT
    const enrichedBookings = bookings.map(booking => {
      const eligibleStatuses = ['approved', 'checked_in', 'completed'];
      const isEligible = eligibleStatuses.includes(booking.bookingStatus);
      const owner = booking.hostel?.owner;

      return {
        ...booking,
        hostContact: isEligible && owner ? {
          phone: owner.phone,
          whatsapp: owner.whatsapp || owner.phone,
          email: owner.email,
          ownerName: owner.name
        } : null
      };
    });

    res.status(200).json({
      success: true,
      message: 'Student bookings retrieved',
      bookings: enrichedBookings,
      results: enrichedBookings,
      data: enrichedBookings
    });
  });

/* =========================================
   GET SINGLE BOOKING
========================================= */
const getBookingById =
  asyncHandler(async (req, res) => {
    const bookingDoc =
      await Booking.findById(
        req.params.id
      )
        .populate({
          path: 'student',
          select: 'name email phone studentId university avatar',
          populate: {
            path: 'university',
            select: 'name'
          }
        })
        .populate('room', 'roomType price images description amenities')
        .populate({
          path: 'hostel',
          populate: {
            path: 'owner',
            select:
              'name email phone whatsapp profileImage',
          },
        });

    if (!bookingDoc) {
      return sendError(res, 'Booking not found', 404);
    }

    const isStudent =
      bookingDoc.student._id.toString() ===
      req.user.id;

    let isOwner = false;

    if (
      bookingDoc.hostel?.owner?._id
    ) {
      isOwner =
        bookingDoc.hostel.owner._id.toString() ===
        req.user.id;
    }

    if (
      !isStudent &&
      !isOwner &&
      req.user.role !== 'admin'
    ) {
      return sendError(res, 'Not authorized', 403);
    }

    // ENRICH WITH GATED HOST CONTACT
    const booking = bookingDoc.toObject();
    const eligibleStatuses = ['approved', 'checked_in', 'completed'];
    const isEligible = eligibleStatuses.includes(booking.bookingStatus);
    const owner = booking.hostel?.owner;

    booking.hostContact = (isStudent && isEligible && owner) ? {
      phone: owner.phone,
      whatsapp: owner.whatsapp || owner.phone,
      email: owner.email,
      ownerName: owner.name
    } : null;

    // For Admin/Owner, always provide full context if requested, 
    // but here we align with the student-centric "My Stays" requirement.

    sendSuccess(res, booking, 'Booking details retrieved');
  });

/* =========================================
   GET ALL BOOKINGS
========================================= */
const getBookings =
  asyncHandler(async (req, res) => {
    const bookings =
      await Booking.find()
        .populate(
          'student',
          'name email'
        )
        .populate('room', 'roomType price occupancyStyle')
        .populate(
          'hostel',
          'name location'
        )
        .sort({
          createdAt: -1,
        });

    sendSuccess(res, bookings, 'All bookings retrieved');
  });

/* =========================================
   OWNER BOOKINGS
========================================= */
const getOwnerBookings =
  asyncHandler(async (req, res) => {
    // 1. Find all hostels owned by this user
    const ownerHostels =
      await Hostel.find({
        owner: req.user.id,
      }).select('_id');

    if (!ownerHostels || ownerHostels.length === 0) {
      return sendSuccess(res, [], 'No bookings found for owner');
    }

    const hostelIds =
      ownerHostels.map(
        (hostel) => hostel._id
      );

    // 2. Find all bookings for these hostels
    const bookings =
      await Booking.find({
        hostel: {
          $in: hostelIds,
        }, paymentStatus: { $ne: 'pending' },
      })
        .populate({
          path: 'student',
          select: 'name email phone studentId university avatar',
          populate: {
            path: 'university',
            select: 'name'
          }
        })
        .populate('room', 'roomType price occupancyStyle')
        .populate(
          'hostel',
          'name location'
        )
        .sort({
          createdAt: -1,
        });

    sendSuccess(res, bookings, 'Owner bookings retrieved');
  });

/* =========================================
   CANCEL BOOKING
========================================= */
const cancelBooking =
  asyncHandler(async (req, res) => {
    const booking =
      await Booking.findById(
        req.params.id
      );

    if (!booking) {
      return sendError(res, 'Booking not found', 404);
    }

    if (
      booking.student.toString() !==
      req.user.id
    ) {
      return sendError(res, 'Not authorized', 401);
    }

    if (
      booking.bookingStatus ===
      'approved'
    ) {
      return sendError(res, 'Approved bookings cannot be cancelled via this endpoint. Please contact support.', 400);
    }

    if (
      booking.paymentStatus ===
      'paid'
    ) {
      return sendError(res, 'Paid bookings cannot be cancelled. Please request a refund through the support center.', 400);
    }

    if (
      booking.bookingStatus ===
      'cancelled'
    ) {
      return sendError(res, 'Booking already cancelled', 400);
    }

    booking.bookingStatus =
      'cancelled';

    await booking.save();

    logLifecycleEvent('booking_cancelled', {
      bookingId: booking._id.toString(),
      roomId: booking.room.toString(),
      hostelId: booking.hostel.toString(),
      studentId: booking.student.toString(),
    });

    const hostel =
      await Hostel.findById(
        booking.hostel
      ).select('owner');

    if (hostel?.owner) {
      await createNotification({
        user: hostel.owner,
        title:
          'Booking cancelled',
        message:
          'A student cancelled a booking.',
        type: 'booking',
        data: {
          booking:
            booking._id,
          hostel:
            booking.hostel,
          room: booking.room,
        },
      });
    }

    await restoreRoomBed(
      booking._id,
      'student_cancelled'
    );

    sendSuccess(res, booking, 'Booking cancelled successfully');
  });

/* =========================================
   UPDATE BOOKING STATUS
========================================= */
const updateBookingStatus =
  asyncHandler(async (req, res) => {
    const { status } =
      req.body;

    if (!['approved', 'rejected', 'completed'].includes(status)) {
      return sendError(res, 'Invalid booking status', 400);
    }

    const booking =
      await Booking.findById(
        req.params.id
      );

    if (!booking) {
      return sendError(res, 'Booking not found', 404);
    }

    if (
      req.user.role ===
      'owner'
    ) {
      const hostel =
        await Hostel.findById(
          booking.hostel
        ).select('owner');

      if (
        !hostel ||
        hostel.owner.toString() !==
          req.user.id
      ) {
        return sendError(res, 'Not authorized', 403);
      }
    }

    if (status === 'completed') {
      if (
        booking.bookingStatus !== 'approved' ||
        booking.paymentStatus !== 'paid'
      ) {
        return sendError(res, 'Only paid approved bookings can be completed', 400);
      }
    }

    if (status === 'rejected') {
      if (booking.paymentStatus === 'paid') {
        return sendError(res, 'Paid bookings cannot be rejected', 400);
      }
    }

    booking.bookingStatus =
      status;

    await booking.save();

    // Populate for logging and response
    await booking.populate([
      { path: 'student', select: 'name email phone studentId university avatar' },
      { path: 'room', select: 'roomType price occupancyStyle' },
      { path: 'hostel', select: 'name location owner' }
    ]);

    // LOG OWNER ACTIVITY (Forensic)
    if (req.user.role === 'owner' || req.user.role === 'admin' || req.admin) {
      await logOwnerActivity({
        ownerId: booking.hostel.owner,
        actorId: req.user.id,
        actorName: req.user.name,
        actorRole: req.user.role,
        eventType: 'booking',
        title: `Booking ${status.charAt(0).toUpperCase() + status.slice(1)}`,
        description: `Owner ${status} booking for ${booking.student.name}`,
        metadata: {
          bookingId: booking._id,
          studentId: booking.student._id,
          status: status,
          hostelName: booking.hostel.name
        }
      });
    }

    logLifecycleEvent('booking_status_updated', {
      bookingId: booking._id.toString(),
      roomId: booking.room.toString(),
      hostelId: booking.hostel.toString(),
      studentId: booking.student.toString(),
      status,
      paymentStatus: booking.paymentStatus,
      actorId: req.user.id,
      actorRole: req.user.role,
    });

    if (status === 'rejected') {
      await restoreRoomBed(
        booking._id,
        'booking_rejected'
      );
    }

    await createNotification({
      user: booking.student,
      title: `Booking ${status}`,
      message: `Your booking has been ${status}.`,
      type: 'booking',
      data: {
        booking:
          booking._id,
        hostel:
          booking.hostel,
        room: booking.room,
        status,
      },
    });

    
      // Populate before sending response
      await booking.populate([
        { path: 'student', select: 'name email phone studentId university avatar' },
        { path: 'room', select: 'roomType price occupancyStyle' },
        { path: 'hostel', select: 'name location' }
      ]);
      
      sendSuccess(res, booking, 'Booking status updated successfully');
  });


/* =========================================
   CHECK-IN STUDENT
========================================= */
const checkInStudent =
  asyncHandler(async (req, res) => {
    console.log("--- CHECK-IN CONTROLLER RECEIVED PAYLOAD ---", req.body);
    const booking =
      await Booking.findById(
        req.params.id
      ).populate({
        path: 'hostel',
        select: 'owner name'
      });

    if (!booking) {
      return sendError(res, 'Booking not found', 404);
    }

    console.log("--- BOOKING BEFORE UPDATE ---", {
        id: booking._id,
        status: booking.bookingStatus,
        room: booking.assignedRoomNumber,
        checkedIn: booking.checkedIn
    });

    // Authorization: Must be owner of the hostel
    if (booking.hostel.owner.toString() !== req.user.id && req.user.role !== 'admin') {
      return sendError(res, 'Not authorized to check-in this student', 403);
    }

    // Business Logic: Must be paid and approved (or already marked completed)
    console.log("CHECK-IN VALIDATION", {
        id: booking._id,
        bookingStatus: booking.bookingStatus,
        paymentStatus: booking.paymentStatus
    });

    const eligibleStatuses = ['approved', 'completed'];
    if (booking.paymentStatus !== 'paid' || !eligibleStatuses.includes(booking.bookingStatus)) {
      return sendError(res, 'Only paid and approved bookings can be checked-in', 400);
    }

    if (booking.checkedIn) {
      return sendError(res, 'Student already checked-in', 400);
    }

    // INPUT NORMALIZATION: Handle both 'assignedRoomNumber' and 'roomNumber', etc.
    const assignedRoomNumber = req.body.assignedRoomNumber || req.body.roomNumber || req.body.room;
    const assignedBedNumber = req.body.assignedBedNumber || req.body.bedNumber || req.body.bed;
    const assignedFloorNumber = req.body.assignedFloorNumber || req.body.floorNumber || req.body.floor;
    const assignedBlock = req.body.assignedBlock || req.body.block;
    const occupancyNotes = req.body.occupancyNotes || req.body.notes;

    if (!assignedRoomNumber) {
      return sendError(res, 'Room number is required for check-in', 400);
    }

    // OCCUPANCY PROTECTION: Prevent assigning same Room + Bed combination
      const existingOccupant = await Booking.findOne({
        assignedRoomNumber,
        assignedBedNumber,
        bookingStatus: 'checked_in',
        hostel: booking.hostel._id
      });

      if (existingOccupant) {
        return sendError(res, `Occupancy Conflict: Room ${assignedRoomNumber}, Bed ${assignedBedNumber} is already occupied by ${existingOccupant.assignedBy ? existingOccupant.assignedBy : 'another student'}.`, 400);
      }

    // 1. Physical Occupancy Data
    booking.checkedIn = true;
    booking.checkedInAt = new Date();
    booking.checkedInBy = req.user.id;
    booking.checkedInByModel = req.user.role === 'admin' || req.admin ? 'Admin' : 'User';
    
    // Determine if this is the first-time assignment or an update
    const isFirstAssignment = !booking.assignedRoomNumber;
    const assignmentTitle = isFirstAssignment ? 'Room Assigned' : 'Room Assignment Updated';

    // 2. Room Assignment Metadata
    booking.assignedRoomNumber = assignedRoomNumber;
    booking.assignedBedNumber = assignedBedNumber;
    booking.assignedFloorNumber = assignedFloorNumber;
    booking.assignedBlock = assignedBlock;
    booking.occupancyNotes = occupancyNotes;
    
    // 3. Assignment Attribution
    booking.assignedBy = req.user.name;
    booking.assignedById = req.user.id;
    booking.assignedByModel = req.user.role === 'admin' || req.admin ? 'Admin' : 'User';
    booking.assignedAt = new Date();

    booking.history.push(
      { 
        event: 'ROOM_ASSIGNED', 
        details: `${assignmentTitle}: Room ${assignedRoomNumber} ${assignedBedNumber ? 'Bed ' + assignedBedNumber : ''} on Floor ${assignedFloorNumber || 'N/A'}`, 
        actor: req.user.id 
      },
      { event: 'CHECKED_IN', details: 'Student successfully checked into the hostel', actor: req.user.id }
    );
    booking.bookingStatus = 'checked_in';

    console.log("--- BOOKING AFTER UPDATE (PRE-SAVE) ---", {
        id: booking._id,
        room: booking.assignedRoomNumber,
        bed: booking.assignedBedNumber,
        floor: booking.assignedFloorNumber,
        block: booking.assignedBlock,
        assignedBy: booking.assignedBy
    });

    await booking.save();
    
    // IMMEDIATELY RE-FETCH FROM DB FOR PROOF OF PERSISTENCE
    const savedBooking = await Booking.findById(booking._id).lean();
    console.log("CHECK-IN SAVED", savedBooking);

    // LOG OWNER ACTIVITY
    await logOwnerActivity({
      ownerId: booking.hostel.owner,
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      eventType: 'residency',
      title: assignmentTitle,
      description: `Owner ${isFirstAssignment ? 'assigned' : 'updated assignment for'} ${booking.student.name} into Room ${booking.assignedRoomNumber}`,
      metadata: {
        bookingId: booking._id,
        studentId: booking.student._id,
        studentName: booking.student.name,
        hostelName: booking.hostel.name,
        roomNumber: booking.assignedRoomNumber,
        bedNumber: booking.assignedBedNumber,
        floorNumber: booking.assignedFloorNumber,
        block: booking.assignedBlock,
        assignedBy: req.user.name
      }
    });

    // Also log the Check-In itself
    await logOwnerActivity({
      ownerId: booking.hostel.owner,
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      eventType: 'residency',
      title: 'Student Checked In',
      description: `Owner checked in ${booking.student.name} into Room ${booking.assignedRoomNumber}`,
      metadata: {
        bookingId: booking._id,
        studentId: booking.student._id,
        studentName: booking.student.name,
        hostelName: booking.hostel.name,
        roomNumber: booking.assignedRoomNumber
      }
    });

    logLifecycleEvent('student_checked_in', {
      bookingId: booking._id.toString(),
      studentId: booking.student.toString(),
      hostelId: booking.hostel._id.toString(),
      actorId: req.user.id
    });
    // SEND NOTIFICATION
    await createNotification({
      user: booking.student._id,
      title: 'Welcome to your Hostel!',
      message: 'You have been successfully checked-in. We hope you enjoy your stay!',
      type: 'booking',
      data: {
        booking: booking._id,
        status: 'checked_in'
      }
    });

    // SEND EMAIL NOTIFICATIONS (Audit Trail)
    try {
      const owner = await User.findById(booking.hostel.owner).select('name email');
      const student = await User.findById(booking.student._id).select('name email');
      
      const checkInTime = new Date().toLocaleString('en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });

      // 1. Email to Owner
      if (owner && owner.email) {
        const ownerEmailMessage = `
          <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; color: #1e293b; line-height: 1.6; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
            <div style="background-color: #0f172a; padding: 30px; text-align: center;">
              <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: 800; letter-spacing: -0.025em;">Relaxly</h1>
            </div>
            
            <div style="padding: 40px 30px;">
              <h2 style="color: #0f172a; margin-top: 0; font-size: 20px; font-weight: 700;">Student Checked In</h2>
              <p style="font-size: 16px;">Hello <strong>${owner.name}</strong>,</p>
              <p style="font-size: 16px;">This is an automated confirmation that a student has successfully checked into your hostel. This transaction is now marked as physically completed.</p>
              
              <div style="background-color: #f8fafc; padding: 25px; border-radius: 12px; border: 1px solid #f1f5f9; margin: 30px 0;">
                <h3 style="margin-top: 0; font-size: 14px; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; margin-bottom: 20px;">Check-In Details</h3>
                
                <table style="width: 100%; border-collapse: collapse;">
                  <tr>
                    <td style="padding: 8px 0; color: #64748b; font-size: 14px;">Student</td>
                    <td style="padding: 8px 0; color: #0f172a; font-size: 14px; font-weight: 600; text-align: right;">${booking.student.name}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; color: #64748b; font-size: 14px;">Booking Code</td>
                    <td style="padding: 8px 0; color: #2563eb; font-size: 14px; font-weight: 700; text-align: right; font-family: monospace;">${booking.bookingCode}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; color: #64748b; font-size: 14px;">Hostel</td>
                    <td style="padding: 8px 0; color: #0f172a; font-size: 14px; font-weight: 600; text-align: right;">${booking.hostel.name}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; color: #64748b; font-size: 14px;">Check-In Time</td>
                    <td style="padding: 8px 0; color: #0f172a; font-size: 14px; font-weight: 600; text-align: right;">${checkInTime}</td>
                  </tr>
                  <tr>
                    <td style="padding: 12px 0 0 0; color: #64748b; font-size: 14px;">Status</td>
                    <td style="padding: 12px 0 0 0; text-align: right;">
                      <span style="background-color: #eff6ff; color: #1e40af; padding: 4px 12px; border-radius: 9999px; font-size: 12px; font-weight: 700; text-transform: uppercase;">Completed</span>
                    </td>
                  </tr>
                </table>
              </div>
            </div>
            
            <div style="background-color: #f8fafc; padding: 30px; text-align: center; border-top: 1px solid #e2e8f0;">
              <p style="margin: 0; font-size: 14px; color: #64748b;">Relaxly Audit Trail • Transaction finalized.</p>
              <div style="margin-top: 25px; padding-top: 25px; border-top: 1px solid #e2e8f0;">
                <p style="font-size: 12px; color: #94a3b8; margin: 0;">© 2026 Relaxly • All rights reserved.</p>
              </div>
            </div>
          </div>
        `;

        await sendEmail({
          email: owner.email,
          subject: 'Student Checked In • Relaxly',
          message: ownerEmailMessage
        });
      }

      // 2. Email to Student
      if (student && student.email) {
        const studentEmailMessage = `
          <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; color: #1e293b; line-height: 1.6; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
            <div style="background-color: #2563eb; padding: 30px; text-align: center;">
              <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: 800; letter-spacing: -0.025em;">Relaxly</h1>
            </div>
            
            <div style="padding: 40px 30px;">
              <h2 style="color: #0f172a; margin-top: 0; font-size: 20px; font-weight: 700;">Check-In Confirmed!</h2>
              <p style="font-size: 16px;">Hello <strong>${student.name}</strong>,</p>
              <p style="font-size: 16px;">You have successfully checked into <strong>${booking.hostel.name}</strong>. We hope you have a wonderful stay!</p>
              
              <div style="background-color: #f8fafc; padding: 25px; border-radius: 12px; border: 1px solid #f1f5f9; margin: 30px 0;">
                <h3 style="margin-top: 0; font-size: 14px; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; margin-bottom: 20px;">Check-In Details</h3>
                
                <table style="width: 100%; border-collapse: collapse;">
                  <tr>
                    <td style="padding: 8px 0; color: #64748b; font-size: 14px;">Hostel</td>
                    <td style="padding: 8px 0; color: #0f172a; font-size: 14px; font-weight: 600; text-align: right;">${booking.hostel.name}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; color: #64748b; font-size: 14px;">Booking Code</td>
                    <td style="padding: 8px 0; color: #2563eb; font-size: 14px; font-weight: 700; text-align: right; font-family: monospace;">${booking.bookingCode}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; color: #64748b; font-size: 14px;">Check-In Time</td>
                    <td style="padding: 8px 0; color: #0f172a; font-size: 14px; font-weight: 600; text-align: right;">${checkInTime}</td>
                  </tr>
                </table>
              </div>
              
              <p style="font-size: 14px; color: #64748b;">If you have any issues during your stay, please contact your hostel manager or Relaxly support.</p>
            </div>
            
            <div style="background-color: #f8fafc; padding: 30px; text-align: center; border-top: 1px solid #e2e8f0;">
              <p style="margin: 0; font-size: 14px; color: #64748b;">Making Student Accommodation Simple.</p>
              <div style="margin-top: 25px; padding-top: 25px; border-top: 1px solid #e2e8f0;">
                <p style="font-size: 12px; color: #94a3b8; margin: 0;">© 2026 Relaxly • All rights reserved.</p>
              </div>
            </div>
          </div>
        `;

        await sendEmail({
          email: student.email,
          subject: 'Check-In Confirmed • Relaxly',
          message: studentEmailMessage
        });
      }
    } catch (error) {
      console.error('[CHECKIN_NOTIFICATION_ERROR]', error.message);
    }


    // Populate before sending response to ensure frontend state remains rich
    await booking.populate([
      { path: 'student', select: 'name email phone studentId university avatar' },
      { path: 'room', select: 'roomType price occupancyStyle' }
    ]);
    
    sendSuccess(res, booking, 'Student checked-in successfully');
  });


/* =========================================
   UPDATE ROOM ASSIGNMENT
========================================= */
const updateRoomAssignment = asyncHandler(async (req, res) => {
  console.log("--- UPDATE ROOM ASSIGNMENT RECEIVED PAYLOAD ---", req.body);
  
  // INPUT NORMALIZATION
  const assignedRoomNumber = req.body.assignedRoomNumber || req.body.roomNumber || req.body.room;
  const assignedBedNumber = req.body.assignedBedNumber || req.body.bedNumber || req.body.bed;
  const assignedFloorNumber = req.body.assignedFloorNumber || req.body.floorNumber || req.body.floor;
  const assignedBlock = req.body.assignedBlock || req.body.block;
  const occupancyNotes = req.body.occupancyNotes || req.body.notes;

  const booking = await Booking.findById(req.params.id).populate('hostel', 'owner name');

  if (!booking) return sendError(res, 'Booking not found', 404);
  
  console.log("--- BOOKING BEFORE UPDATE ---", {
      id: booking._id,
      room: booking.assignedRoomNumber,
      floor: booking.assignedFloorNumber
  });

  if (booking.hostel.owner.toString() !== req.user.id && req.user.role !== 'admin') {
    return sendError(res, 'Not authorized to update room assignment', 403);
  }

  const oldRoom = booking.assignedRoomNumber;
  const oldFloor = booking.assignedFloorNumber;
  
  // Determine if this is the first-time assignment or an update
  const isFirstAssignment = !oldRoom;
  const assignmentTitle = isFirstAssignment ? 'Room Assigned' : 'Room Assignment Updated';

  // 1. Physical Occupancy Data
  booking.assignedRoomNumber = assignedRoomNumber || booking.assignedRoomNumber;
  booking.assignedBedNumber = assignedBedNumber || booking.assignedBedNumber;
  booking.assignedFloorNumber = assignedFloorNumber || booking.assignedFloorNumber;
  booking.assignedBlock = assignedBlock || booking.assignedBlock;
  booking.occupancyNotes = occupancyNotes || booking.occupancyNotes;

  // 2. Assignment Attribution
  booking.assignedBy = req.user.name;
  booking.assignedById = req.user.id;
  booking.assignedByModel = req.user.role === 'admin' || req.admin ? 'Admin' : 'User';
  booking.assignedAt = new Date();

  booking.history.push({
    event: 'ROOM_ASSIGNMENT_UPDATED',
    details: `${assignmentTitle}: Room ${oldRoom || 'N/A'} (Floor ${oldFloor || 'N/A'}) -> Room ${booking.assignedRoomNumber} (Floor ${booking.assignedFloorNumber || 'N/A'})`,
    actor: req.user.id
  });

  console.log("--- BOOKING AFTER UPDATE (PRE-SAVE) ---", {
      id: booking._id,
      room: booking.assignedRoomNumber,
      bed: booking.assignedBedNumber,
      assignedBy: booking.assignedBy
  });

  await booking.save();
  
  console.log("--- BOOKING SAVED (PROOF OF PERSISTENCE) ---");
  console.log({
    assignedRoomNumber: booking.assignedRoomNumber,
    assignedBedNumber: booking.assignedBedNumber,
    assignedFloorNumber: booking.assignedFloorNumber,
    assignedBlock: booking.assignedBlock
  });

  // LOG OWNER ACTIVITY
  await logOwnerActivity({
    ownerId: booking.hostel.owner,
    actorId: req.user.id,
    actorName: req.user.name,
    actorRole: req.user.role,
    eventType: 'residency',
    title: assignmentTitle,
    description: `Owner ${isFirstAssignment ? 'assigned' : 'updated assignment for'} ${booking.student?.name || 'student'} to Room ${booking.assignedRoomNumber}`,
    metadata: {
      bookingId: booking._id,
      studentId: booking.student?._id,
      hostelName: booking.hostel?.name,
      roomNumber: booking.assignedRoomNumber,
      bedNumber: booking.assignedBedNumber,
      floorNumber: booking.assignedFloorNumber,
      block: booking.assignedBlock,
      assignedBy: req.user.name
    }
  });
  
  
    // Populate before sending response
    await booking.populate([
      { path: 'student', select: 'name email phone studentId university avatar' },
      { path: 'room', select: 'roomType price occupancyStyle' }
    ]);
    
    sendSuccess(res, booking, 'Room assignment updated successfully');
});


/* =========================================
   CHECK-OUT STUDENT
========================================= */
const checkOutStudent = asyncHandler(async (req, res) => {
  const booking = await Booking.findById(req.params.id).populate('hostel', 'owner');

  if (!booking) return sendError(res, 'Booking not found', 404);
  
  if (booking.hostel.owner.toString() !== req.user.id && req.user.role !== 'admin') {
    return sendError(res, 'Not authorized to check-out this student', 403);
  }

  if (booking.bookingStatus !== 'checked_in' && booking.bookingStatus !== 'completed') {
    return sendError(res, 'Student is not in a status that allows check-out', 400);
  }

  if (booking.bookingStatus === 'completed' && !booking.checkedIn) {
    return sendSuccess(res, booking, 'Student is already checked out');
  }

  booking.bookingStatus = 'completed';
  booking.checkedIn = false;
  booking.checkedOutAt = new Date();
  booking.checkedOutBy = req.user.id;

  booking.history.push({
    event: 'CHECKED_OUT',
    details: `Student checked out from Room ${booking.assignedRoomNumber}`,
    actor: req.user.id
  });

  await booking.save();

  // LOG OWNER ACTIVITY
  await logOwnerActivity({
    ownerId: booking.hostel.owner,
    actorId: req.user.id,
    actorName: req.user.name,
    actorRole: req.user.role,
    eventType: 'residency',
    title: 'Student Checked Out',
    description: `Owner checked out ${booking.student?.name || 'student'} from Room ${booking.assignedRoomNumber}`,
    metadata: {
      bookingId: booking._id,
      studentId: booking.student?._id,
      studentName: booking.student?.name,
      hostelName: booking.hostel?.name,
      roomNumber: booking.assignedRoomNumber,
      checkedOutBy: req.user.name
    }
  });

  // Populate before sending response to ensure frontend state remains rich
  await booking.populate([
    { path: 'student', select: 'name email phone studentId university avatar' },
    { path: 'room', select: 'roomType price occupancyStyle' }
  ]);
  
  sendSuccess(res, booking, 'Student checked out successfully');
});

module.exports = {
  createBooking,
  getBookings,
  getMyBookings,
  getBookingById,
  getOwnerBookings,
  cancelBooking,
  updateBookingStatus,
  checkInStudent,
  updateRoomAssignment,
  checkOutStudent,
};


