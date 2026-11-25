import * as notificationRepository from '../repositories/notificationRepository.js';

export async function list(req, res) {
  const notifications = await notificationRepository.listForUser(req.user.id);
  return res.json({
    notifications,
    unreadCount: notifications.filter((notification) => !notification.readAt).length,
  });
}

export async function markRead(req, res) {
  const updated = await notificationRepository.markAsRead(req.params.id, req.user.id);
  if (!updated) return res.status(404).json({ message: 'Notification not found or already read.' });
  return res.json({ message: 'Notification marked as read.' });
}

export async function markAllRead(req, res) {
  const updatedCount = await notificationRepository.markAllAsRead(req.user.id);
  return res.json({ message: 'Notifications marked as read.', updatedCount });
}
