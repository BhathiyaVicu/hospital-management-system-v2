import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { getNotifications, markAllNotificationsRead, markNotificationRead } from '../../services/api';

export default function NotificationBell() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [updating, setUpdating] = useState(false);

  const loadNotifications = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true);
    try {
      const result = await getNotifications();
      setNotifications(result.notifications || []);
      setUnreadCount(result.unreadCount || 0);
      setError('');
      setLoaded(true);
    } catch (requestError) {
      setError(requestError.message || 'Unable to load notifications.');
      setLoaded(true);
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    getNotifications()
      .then((result) => {
        if (!active) return;
        setNotifications(result.notifications || []);
        setUnreadCount(result.unreadCount || 0);
        setError('');
        setLoaded(true);
      })
      .catch((requestError) => {
        if (!active) return;
        setError(requestError.message || 'Unable to load notifications.');
        setLoaded(true);
      });
    const handleChange = () => { loadNotifications(); };
    window.addEventListener('notifications:changed', handleChange);
    return () => {
      active = false;
      window.removeEventListener('notifications:changed', handleChange);
    };
  }, [loadNotifications, pathname]);

  const openNotification = async (notification) => {
    if (!notification.readAt) {
      setUpdating(true);
      try {
        await markNotificationRead(notification.id);
        setNotifications((current) => current.map((item) => item.id === notification.id
          ? { ...item, readAt: new Date().toISOString() } : item));
        setUnreadCount((count) => Math.max(0, count - 1));
        window.dispatchEvent(new CustomEvent('notifications:changed'));
      } catch (requestError) {
        setError(requestError.message || 'Unable to mark this notification as read.');
        return;
      } finally {
        setUpdating(false);
      }
    }
    setOpen(false);
    navigate(notification.link || '/notifications');
  };

  const markAllRead = async () => {
    setUpdating(true);
    setError('');
    try {
      await markAllNotificationsRead();
      const readAt = new Date().toISOString();
      setNotifications((current) => current.map((item) => ({ ...item, readAt: item.readAt || readAt })));
      setUnreadCount(0);
      window.dispatchEvent(new CustomEvent('notifications:changed'));
    } catch (requestError) {
      setError(requestError.message || 'Unable to mark notifications as read.');
    } finally {
      setUpdating(false);
    }
  };

  return (
    <div className="relative">
      <button
        type="button"
        aria-label={unreadCount ? `Notifications, ${unreadCount} unread` : 'Notifications'}
        aria-expanded={open}
        onClick={() => {
          setOpen((current) => !current);
          if (!open) loadNotifications(true);
        }}
        className="relative inline-flex h-10 w-10 items-center justify-center rounded-full text-on-surface-variant transition hover:bg-surface-container hover:text-primary"
      >
        <span className="material-symbols-outlined">notifications</span>
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>
      {open && (
        <section aria-label="Recent notifications" className="absolute right-0 top-12 z-[70] w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
          <header className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <h2 className="text-sm font-semibold text-on-surface">Notifications</h2>
            <button type="button" onClick={markAllRead} disabled={!unreadCount || updating} className="text-xs font-semibold text-primary disabled:opacity-50">
              Mark all read
            </button>
          </header>
          {error && <p role="alert" className="px-4 py-2 text-xs text-error">{error}</p>}
          {(loading || !loaded) && !notifications.length ? (
            <p className="px-4 py-6 text-center text-sm text-on-surface-variant">Loading notifications...</p>
          ) : notifications.length ? (
            <ul className="max-h-96 divide-y divide-slate-100 overflow-y-auto">
              {notifications.slice(0, 8).map((notification) => (
                <li key={notification.id}>
                  <button type="button" disabled={updating} onClick={() => openNotification(notification)} className={`flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-surface-container disabled:opacity-60 ${notification.readAt ? '' : 'bg-primary/5'}`}>
                    <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${notification.readAt ? 'bg-slate-300' : 'bg-red-500'}`} />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-on-surface">{notification.title}</span>
                      <span className="mt-0.5 block line-clamp-2 text-xs text-on-surface-variant">{notification.message}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-4 py-6 text-center text-sm text-on-surface-variant">You have no notifications.</p>
          )}
          <button type="button" onClick={() => { setOpen(false); navigate('/notifications'); }} className="w-full border-t border-slate-100 px-4 py-3 text-center text-sm font-semibold text-primary hover:bg-surface-container">
            View all notifications
          </button>
        </section>
      )}
    </div>
  );
}
