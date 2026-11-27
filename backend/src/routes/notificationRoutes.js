import { Router } from 'express';
import * as controller from '../controllers/notificationController.js';
import { authenticate, requireRole, requireVerifiedEmail } from '../middleware/authenticate.js';

const router = Router();

router.use(authenticate, requireVerifiedEmail, requireRole('patient', 'doctor', 'staff'));
router.get('/', controller.list);
router.patch('/read-all', controller.markAllRead);
router.patch('/:id/read', controller.markRead);

export default router;
