import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import PortalHeading from '../components/common/PortalHeading';
import StatusBadge from '../components/common/StatusBadge';
import { getPatientTicket, replyToPatientTicket } from '../services/api';

function dateTime(value) {
  if (!value) return '';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

export default function PatientTicketDetailsPage() {
  const { ticketId } = useParams();
  const [ticket, setTicket] = useState(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadTicket = useCallback(async () => {
    try {
      const { data } = await getPatientTicket(ticketId);
      setTicket(data);
    } catch (requestError) {
      setError(requestError.message || 'Unable to load this support request.');
    } finally {
      setLoading(false);
    }
  }, [ticketId]);

  useEffect(() => {
    loadTicket();
  }, [loadTicket]);

  const handleReply = async (event) => {
    event.preventDefault();
    if (!message.trim()) return;
    setSaving(true);
    setError('');
    try {
      await replyToPatientTicket(ticketId, message);
      setMessage('');
      await loadTicket();
    } catch (requestError) {
      setError(requestError.message || 'Unable to send this reply.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="mx-auto max-w-7xl px-4 py-16 text-center text-on-surface-variant">Loading support ticket...</div>;
  if (error && !ticket) return <div role="alert" className="mx-auto max-w-7xl px-4 py-12 text-center text-red-700">{error}</div>;
  if (!ticket) return null;

  const currentStatus = ticket.status || 'open';
  const messages = ticket.messages || [];
  const isResolvedOrClosed = currentStatus === 'resolved' || currentStatus === 'closed';

  return (
    <div className="bg-surface pb-16">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-5 flex flex-wrap items-center gap-2 text-sm text-on-surface-variant">
          <Link to="/support" className="hover:text-primary">My Support Tickets</Link>
          <span>/</span>
          <span className="font-medium text-on-surface">{ticket.ticketNumber || 'Ticket Details'}</span>
        </div>

        <PortalHeading 
          eyebrow={`Support ticket · ${ticket.ticketNumber || ''}`} 
          title={ticket.subject || 'Ticket Details'} 
          description={`Created ${dateTime(ticket.createdAt)}`} 
          actions={<StatusBadge status={currentStatus} />} 
        />

        {error && <p role="alert" className="mb-5 rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p>}

        {/* Changed to a wider grid: 2/3 for chat, 1/3 for details */}
        <div className="grid items-start gap-6 lg:grid-cols-[2fr_1fr]">
          
          <section className="rounded-2xl bg-surface-container-lowest p-5 shadow-sm ring-1 ring-slate-200 sm:p-6">
            <h2 className="mb-5 text-xl font-semibold text-on-surface">Conversation</h2>
            
            <div className="space-y-4">
              {messages.map((item) => {
                const fromPatient = item.senderRole === 'patient';
                return (
                  <article key={item.id} className={`max-w-[90%] rounded-2xl p-4 sm:max-w-[75%] ${fromPatient ? 'ml-auto bg-primary text-on-primary' : 'bg-surface-container text-on-surface'}`}>
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span className={`font-semibold ${fromPatient ? 'text-on-primary' : 'text-primary'}`}>
                        {fromPatient ? 'You' : item.senderName || 'Support staff'}
                      </span>
                      <time className={fromPatient ? 'text-on-primary/75' : 'text-on-surface-variant'}>
                        {dateTime(item.createdAt)}
                      </time>
                    </div>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{item.message}</p>
                  </article>
                );
              })}
              {messages.length === 0 && (
                <p className="py-5 text-center text-sm text-on-surface-variant">No messages yet.</p>
              )}
            </div>

            {/* 👇 BLOCK REPLY IF RESOLVED OR CLOSED 👇 */}
            {isResolvedOrClosed ? (
              <p className="mt-6 rounded-xl border border-slate-200 bg-surface-container-low p-4 text-sm text-on-surface-variant">
                This ticket is {currentStatus}; replies are unavailable. If you need further assistance, please create a new ticket.
              </p>
            ) : (
              <form onSubmit={handleReply} className="mt-6 border-t border-slate-100 pt-5">
                <label htmlFor="patient-reply" className="mb-2 block text-sm font-semibold text-on-surface">Reply to support</label>
                <textarea 
                  id="patient-reply" 
                  value={message} 
                  onChange={(event) => setMessage(event.target.value)} 
                  maxLength={5000} 
                  rows={4} 
                  required 
                  placeholder="Write a response..." 
                  className="w-full resize-y rounded-xl border border-slate-200 px-3 py-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15" 
                />
                <div className="mt-2 flex justify-between text-xs text-on-surface-variant">
                  <span>Replies will be sent to the support team.</span>
                  <span>{message.length}/5000</span>
                </div>
                <button 
                  type="submit" 
                  disabled={saving || !message.trim()} 
                  className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-on-primary disabled:opacity-60"
                >
                  <span className="material-symbols-outlined text-lg">send</span>
                  {saving ? 'Sending...' : 'Send Reply'}
                </button>
              </form>
            )}
          </section>

          <aside className="space-y-4">
            <section className="rounded-2xl bg-surface-container-lowest p-5 shadow-sm ring-1 ring-slate-200">
              <h2 className="font-semibold text-on-surface">Ticket details</h2>
              <dl className="mt-4 space-y-4 text-sm">
                <div>
                  <dt className="text-xs text-on-surface-variant uppercase tracking-wider font-semibold">Status</dt>
                  <dd className="mt-1"><StatusBadge status={currentStatus} /></dd>
                </div>
                <div>
                  <dt className="text-xs text-on-surface-variant uppercase tracking-wider font-semibold">Category</dt>
                  <dd className="mt-1 font-medium capitalize text-on-surface">{ticket.category || 'General'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-on-surface-variant uppercase tracking-wider font-semibold">Priority</dt>
                  <dd className="mt-1 font-medium capitalize text-on-surface">{ticket.priority || 'Normal'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-on-surface-variant uppercase tracking-wider font-semibold">Last Updated</dt>
                  <dd className="mt-1 font-medium text-on-surface">{dateTime(ticket.updatedAt)}</dd>
                </div>
              </dl>
            </section>
            
            <Link to="/support" className="inline-flex text-sm font-semibold text-primary hover:underline">
              Back to support
            </Link>
          </aside>
        </div>
      </div>
    </div>
  );
}