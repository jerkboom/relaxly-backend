const express = require('express');

const router = express.Router();

const {
setupPayoutMethod,
getMyPayoutMethod,
updatePayoutMethod,
verifyPayoutMethod,
} = require('../controllers/payoutMethodController');

const {
protect,
} = require('../middleware/authMiddleware');

router.use(protect);

router.post('/setup', setupPayoutMethod);

router.get('/me', getMyPayoutMethod);

router.put('/update', updatePayoutMethod);

router.post('/verify', verifyPayoutMethod);

module.exports = router;
