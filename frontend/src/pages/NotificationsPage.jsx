import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getNotifications, markAllNotificationsRead, markNotificationRead } from '../services/api';

export default function NotificationsPage() {
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [markingAll, setMarkingAll] = useState(false);

  useEffect(() => {
    let active = true;
    getNotifications()
      .then(({ notifications: items = [] }) => {
        if (active) setNotifications(items);
      })
      .catch((requestError) => {
        if (active) setError(requestError.message || 'Unable to load notifications.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, []);

  const openNotification = async (notification) => {
    setError('');
    try {
      if (!notification.readAt) {
        await markNotificationRead(notification.id);
        setNotifications((current) => current.map((item) => item.id === notification.id
          ? { ...item, readAt: new Date().toISOString() } : item));
        window.dispatchEvent(new CustomEvent('notifications:changed'));
      }
      if (notification.link) navigate(notification.link);
    } catch (requestError) {
      setError(requestError.message || 'Unable to mark this notification as read.');
    }
  };

  const markAllRead = async () => {
    setMarkingAll(true);
    setError('');
    try {
      await markAllNotificationsRead();
      const readAt = new Date().toISOString();
      setNotifications((current) => current.map((item) => ({ ...item, readAt: item.readAt || readAt })));
      window.dispatchEvent(new CustomEvent('notifications:changed'));
    } catch (requestError) {
      setError(requestError.message || 'Unable to mark notifications as read.');
    } finally {
      setMarkingAll(false);
    }
  };

  return (
    <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
      <header className="mb-7 flex items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Updates</p>
          <h1 className="mt-2 text-3xl font-semibold text-on-surface">Notifications</h1>
        </div>
        {!!notifications.some((item) => !item.readAt) && (
          <button type="button" onClick={markAllRead} disabled={markingAll} className="rounded-lg px-3 py-2 text-sm font-semibold text-primary hover:bg-primary/5 disabled:opacity-50">
            {markingAll ? 'Marking...' : 'Mark all read'}
          </button>
        )}
      </header>
      {error && <p role="alert" className="mb-4 rounded-xl bg-error-container p-3 text-sm text-error">{error}</p>}
      {loading ? (
        <p className="py-12 text-center text-on-surface-variant">Loading notifications...</p>
      ) : notifications.length ? (
        <ul className="divide-y divide-slate-200 overflow-hidden rounded-2xl border border-slate-200 bg-surface-container-lowest">
          {notifications.map((notification) => (
            <li key={notification.id}>
              <button
                type="button"
                onClick={() => openNotification(notification)}
                className={`flex w-full items-start gap-4 px-5 py-4 text-left transition hover:bg-surface-container ${
                  notification.readAt ? '' : 'bg-primary/5'
                }`}
              >
                <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${notification.readAt ? 'bg-slate-300' : 'bg-red-500'}`} />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold text-on-surface">{notification.title}</span>
                  <span className="mt-1 block text-sm text-on-surface-variant">{notification.message}</span>
                  <time className="mt-2 block text-xs text-on-surface-variant" dateTime={notification.createdAt}>
                    {new Date(notification.createdAt).toLocaleString()}
                  </time>
                </span>
                {notification.link && <span className="material-symbols-outlined text-primary" aria-hidden="true">chevron_right</span>}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-2xl border border-slate-200 bg-surface-container-lowest px-5 py-12 text-center text-on-surface-variant">
          You have no notifications.
        </p>
      )}
    </main>
  );
}
