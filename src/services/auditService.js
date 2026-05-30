const AdminAuditLog = require('../models/AdminAuditLog');
const { Parser } = require('json2csv');
const PDFDocument = require('pdfkit');
const crypto = require('crypto');

const toPlainLog = (log) => {
  const value = typeof log.toObject === 'function' ? log.toObject() : log;
  const checksumPayload = JSON.stringify({
    id: value._id,
    admin: value.admin?._id || value.admin,
    actionType: value.actionType,
    targetType: value.targetType,
    targetId: value.targetId,
    createdAt: value.createdAt,
    metadata: value.metadata || {},
  });

  return {
    ...value,
    auditChecksum: crypto.createHash('sha256').update(checksumPayload).digest('hex'),
    apiRoute: value.metadata?.route || value.metadata?.path || value.metadata?.apiRoute || 'N/A',
    executionDuration: value.metadata?.durationMs || value.metadata?.executionDuration || null,
    beforeState: value.metadata?.before || value.metadata?.beforeState || null,
    afterState: value.metadata?.after || value.metadata?.afterState || null,
  };
};

class AuditService {
  /**
   * Get filtered, paginated audit logs
   */
  async getAuditLogs(queryObj) {
    const { 
      search, 
      admin, 
      actionType, 
      targetType, 
      severity, 
      status,
      startDate, 
      endDate,
      page = 1, 
      limit = 20 
    } = queryObj;

    const query = {};

    if (admin) query.admin = admin;
    if (actionType) query.actionType = actionType;
    if (targetType) query.targetType = targetType;
    if (severity) query.severity = severity;
    if (status) query.status = status;

    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    if (search) {
      // In a more complex app, we might search admin names by populating and then filtering,
      // but for direct fields:
      query.$or = [
        { ipAddress: { $regex: search, $options: 'i' } },
        { userAgent: { $regex: search, $options: 'i' } },
        { actionType: { $regex: search, $options: 'i' } }
      ];
    }

    const logs = await AdminAuditLog.find(query)
      .populate('admin', 'name email role')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));

    const total = await AdminAuditLog.countDocuments(query);

    return {
      logs,
      pagination: {
        total,
        page: Number(page),
        limit: Number(limit),
        pages: Math.ceil(total / limit)
      }
    };
  }

  /**
   * Get log detail by ID
   */
  async getLogById(id) {
    const log = await AdminAuditLog.findById(id).populate('admin', 'name email role');
    if (!log) throw new Error('Audit log entry not found');
    return toPlainLog(log);
  }

  async getAdminActivity(adminId, queryObj = {}) {
    const { page = 1, limit = 10 } = queryObj;
    const normalizedLimit = Math.min(Number(limit) || 10, 100);
    const normalizedPage = Math.max(Number(page) || 1, 1);

    const query = { admin: adminId };
    const logs = await AdminAuditLog.find(query)
      .populate('admin', 'name email role')
      .sort({ createdAt: -1 })
      .skip((normalizedPage - 1) * normalizedLimit)
      .limit(normalizedLimit);

    const total = await AdminAuditLog.countDocuments(query);

    return {
      logs: logs.map(toPlainLog),
      pagination: {
        total,
        page: normalizedPage,
        limit: normalizedLimit,
        pages: Math.ceil(total / normalizedLimit),
      },
    };
  }

  async getAdminActivityLogById(adminId, id) {
    const log = await AdminAuditLog.findOne({ _id: id, admin: adminId }).populate('admin', 'name email role');
    if (!log) {
      const error = new Error('Audit log entry not found');
      error.statusCode = 404;
      throw error;
    }

    return toPlainLog(log);
  }

  async exportAdminActivity(adminId, format = 'csv') {
    const { logs } = await this.getAdminActivity(adminId, { page: 1, limit: 10000 });
    const rows = logs.map((log) => ({
      timestamp: log.createdAt ? new Date(log.createdAt).toISOString() : '',
      operation: log.actionType,
      resource: `${log.targetType || 'N/A'}${log.targetId ? `:${log.targetId}` : ''}`,
      ipAddress: log.ipAddress || 'N/A',
      status: log.status || 'success',
      metadata: log.metadata || {},
      auditChecksum: log.auditChecksum,
    }));

    if (format === 'json') {
      return {
        contentType: 'application/json',
        body: JSON.stringify(rows, null, 2),
      };
    }

    if (format === 'pdf') {
      return {
        contentType: 'application/pdf',
        body: rows,
      };
    }

    const fields = [
      { label: 'Timestamp', value: 'timestamp' },
      { label: 'Operation', value: 'operation' },
      { label: 'Resource', value: 'resource' },
      { label: 'IP Address', value: 'ipAddress' },
      { label: 'Status', value: 'status' },
      { label: 'Metadata', value: (row) => JSON.stringify(row.metadata) },
      { label: 'Audit Checksum', value: 'auditChecksum' },
    ];

    return {
      contentType: 'text/csv',
      body: new Parser({ fields }).parse(rows),
    };
  }

  /**
   * Get security metrics for dashboard cards
   */
  async getAuditMetrics() {
    const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [stats] = await AdminAuditLog.aggregate([
      {
        $facet: {
          failedAuth: [
            { $match: { 
                actionType: { $regex: 'LOGIN|AUTH', $options: 'i' }, 
                status: 'failure',
                createdAt: { $gte: last24h }
            } },
            { $count: 'count' }
          ],
          severityBreakdown: [
            { $match: { createdAt: { $gte: last24h } } },
            { $group: { 
                _id: { $ifNull: ['$severity', 'low'] }, 
                count: { $sum: 1 } 
            } }
          ],
          sensitiveActions: [
            { $match: { 
                severity: { $in: ['high', 'critical'] },
                createdAt: { $gte: last24h }
            } },
            { $count: 'count' }
          ]
        }
      }
    ]);

    return {
      failedAuthAttempts: stats.failedAuth[0]?.count || 0,
      sensitiveActions24h: stats.sensitiveActions[0]?.count || 0,
      severityBreakdown: stats.severityBreakdown.reduce((acc, curr) => {
        acc[curr._id] = curr.count;
        return acc;
      }, {}),
      integrityStatus: 'healthy' // In real world, we'd check hash chains
    };
  }

  /**
   * Export audit trail to CSV
   */
  async exportToCSV(queryObj) {
    const { logs } = await this.getAuditLogs({ ...queryObj, limit: 10000 });
    
    const fields = [
      { label: 'Timestamp', value: (row) => new Date(row.createdAt).toISOString() },
      { label: 'Admin', value: (row) => row.admin?.name || 'System' },
      { label: 'Action', value: 'actionType' },
      { label: 'Target Type', value: 'targetType' },
      { label: 'Target ID', value: 'targetId' },
      { label: 'Severity', value: 'severity' },
      { label: 'Status', value: 'status' },
      { label: 'IP Address', value: 'ipAddress' },
      { label: 'User Agent', value: 'userAgent' },
      { label: 'Metadata', value: (row) => JSON.stringify(row.metadata) }
    ];

    const parser = new Parser({ fields });
    return parser.parse(logs);
  }

  /**
   * Generate PDF Audit Report (Streamed)
   */
  async generatePDFReport(res, queryObj) {
    const { logs } = await this.getAuditLogs({ ...queryObj, limit: 1000 });
    
    const doc = new PDFDocument({ margin: 30 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=audit-trail-report.pdf');
    
    doc.pipe(res);
    
    // Header
    doc.fontSize(20).text('Security Audit Trail Report', { align: 'center' });
    doc.fontSize(10).text(`Generated at: ${new Date().toLocaleString()}`, { align: 'center' });
    doc.moveDown();
    
    // Table-like structure
    doc.fontSize(8).text('Date', 30, doc.y, { width: 80, continued: true });
    doc.text('Admin', { width: 80, continued: true });
    doc.text('Action', { width: 100, continued: true });
    doc.text('Resource', { width: 80, continued: true });
    doc.text('Severity', { width: 50, continued: true });
    doc.text('IP Address', { width: 80 });
    doc.moveDown(0.5);
    doc.moveTo(30, doc.y).lineTo(580, doc.y).stroke();
    doc.moveDown(0.5);

    logs.forEach(log => {
      if (doc.y > 700) doc.addPage();
      
      const date = new Date(log.createdAt);
      const dateStr = `${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:${date.getMinutes()}`;
      doc.text(dateStr, 30, doc.y, { width: 80, continued: true });
      doc.text(log.admin?.name?.substring(0, 15) || 'System', { width: 80, continued: true });
      doc.text(log.actionType.replace(/_/g, ' '), { width: 100, continued: true });
      doc.text(log.targetType, { width: 80, continued: true });
      doc.text(log.severity, { width: 50, continued: true });
      doc.text(log.ipAddress || 'N/A', { width: 80 });
      doc.moveDown();
    });

    doc.end();
  }
}

module.exports = new AuditService();
