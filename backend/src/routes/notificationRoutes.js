import { Router } from 'express';
import * as controller from '../controllers/notificationController.js';
import { authenticate, requireVerifiedEmail } from '../middleware/authenticate.js';

const router = Router();

router.use(authenticate, requireVerifiedEmail);
router.get('/', controller.list);
router.patch('/read-all', controller.markAllRead);
router.patch('/:id/read', controller.markRead);

export default router;
