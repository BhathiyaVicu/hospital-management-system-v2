import { useEffect, useState } from 'react';
import PortalHeading from '../components/common/PortalHeading';
import StatusBadge from '../components/common/StatusBadge';
import { AdminNotice, AdminSection, AdminTable, formatAdminDate } from '../components/admin/AdminComponents';
import {
  getAdminSupportTicket,
  getAdminSupportTickets,
} from '../services/api';

const ticketStatuses = ['open', 'in_progress', 'waiting_for_patient', 'resolved', 'closed'];

function TicketDialog({ ticketId, onClose }) {
  const [ticket, setTicket] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    getAdminSupportTicket(ticketId)
      .then(({ data }) => { if (active) setTicket(data); })
      .catch((requestError) => { if (active) setError(requestError.message || 'Unable to load ticket.'); });
    return () => { active = false; };
  }, [ticketId]);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/50 p-3 sm:p-5">
      <section role="dialog" aria-modal="true" aria-labelledby="admin-ticket-title" className="max-h-[94vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl sm:p-7">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-primary">
              {ticket?.ticketNumber || 'Support case'}
            </p>
            <h2 id="admin-ticket-title" className="mt-1 text-xl font-semibold">
              {ticket?.subject || 'Ticket details'}
            </h2>
          </div>
          <button type="button" aria-label="Close ticket" onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-lg hover:bg-surface-container">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        
        {error && <AdminNotice>{error}</AdminNotice>}
        
        {!ticket ? (
          <p className="py-10 text-center text-sm text-on-surface-variant">Loading ticket...</p>
        ) : (
          <>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <StatusBadge status={ticket.status} />
              <span className="rounded-full bg-surface-container px-3 py-1 text-xs capitalize">
                {ticket.category} · {ticket.priority} priority
              </span>
            </div>

            {/* Ticket Details & Assigned Staff */}
            <div className="mt-4 grid gap-3 sm:grid-cols-2 rounded-xl bg-surface-container-lowest border border-slate-100 p-4 text-sm">
              <div>
                <p className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider">Patient</p>
                <p className="mt-1 font-medium text-on-surface">{ticket.patientName}</p>
                <p className="text-xs text-on-surface-variant">{ticket.patientEmail}</p>
              </div>
              <div>
                <p className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider">Assigned Staff</p>
                <p className="mt-1 font-medium text-on-surface">
                  {ticket.assignedStaffName || <span className="text-on-surface-variant italic">Unassigned</span>}
                </p>
              </div>
              {ticket.appointmentStart && (
                <div className="sm:col-span-2 border-t border-slate-100 pt-3 mt-1">
                  <p className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider">Linked Appointment</p>
                  <p className="mt-1 font-medium text-on-surface">
                    {formatAdminDate(ticket.appointmentStart, { timeStyle: 'short' })} with {ticket.appointmentDoctorName}
                  </p>
                </div>
              )}
            </div>

            <div className="mt-5 space-y-3 rounded-xl bg-surface-container-low p-4">
              <p className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-2">Message History</p>
              {(ticket.messages || []).map((item) => (
                <article key={item.id} className="rounded-xl bg-white p-3 shadow-sm ring-1 ring-slate-100">
                  <div className="flex flex-wrap justify-between gap-2">
                    <p className="text-sm font-semibold">
                      {item.senderName} <span className="font-normal text-on-surface-variant">· {item.senderRole}</span>
                    </p>
                    <time className="text-xs text-on-surface-variant">
                      {formatAdminDate(item.createdAt, { timeStyle: 'short' })}
                    </time>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-on-surface">{item.message}</p>
                </article>
              ))}
              {!ticket.messages?.length && (
                <p className="py-5 text-center text-sm text-on-surface-variant">No messages in this ticket yet.</p>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

export default function AdminSupportPage() {
  const [filters, setFilters] = useState({ search: '', status: '', category: '' });
  const [tickets, setTickets] = useState([]);
  const [total, setTotal] = useState(0);
  const [selectedId, setSelectedId] = useState('');
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const limit = 30;

  useEffect(() => {
    let active = true;
    getAdminSupportTickets({ ...filters, limit, offset })
      .then(({ data, pagination }) => {
        if (!active) return;
        setTickets(data || []);
        setTotal(pagination?.total || 0);
        setError('');
      })
      .catch((requestError) => { if (active) setError(requestError.message || 'Unable to load support tickets.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [filters, offset]);

  return (
    <>
      <PortalHeading 
        eyebrow="Team & security" 
        title="Support & Inquiries Administration" 
        description="Review patient inquiries and monitor support cases." 
      />
      
      {error && <AdminNotice>{error}</AdminNotice>}
      
      <AdminSection>
        <div className="mb-5 grid gap-3 sm:grid-cols-3">
          <input 
            aria-label="Search support tickets" 
            value={filters.search} 
            onChange={(event) => { setLoading(true); setFilters((current) => ({ ...current, search: event.target.value })); setOffset(0); }} 
            placeholder="Search reference, subject, patient" 
            className="h-11 rounded-lg border border-slate-200 px-3 text-sm" 
          />
          <select 
            aria-label="Filter tickets by status" 
            value={filters.status} 
            onChange={(event) => { setLoading(true); setFilters((current) => ({ ...current, status: event.target.value })); setOffset(0); }} 
            className="h-11 rounded-lg border border-slate-200 bg-white px-3 text-sm"
          >
            <option value="">All statuses</option>
            {ticketStatuses.map((status) => <option key={status} value={status}>{status.replaceAll('_', ' ')}</option>)}
          </select>
          <select 
            aria-label="Filter tickets by category" 
            value={filters.category} 
            onChange={(event) => { setLoading(true); setFilters((current) => ({ ...current, category: event.target.value })); setOffset(0); }} 
            className="h-11 rounded-lg border border-slate-200 bg-white px-3 text-sm"
          >
            <option value="">All categories</option>
            <option value="feedback">Feedback</option>
            <option value="complaint">Complaint</option>
            <option value="inquiry">Inquiry</option>
          </select>
        </div>
        
        <p className="mb-3 text-xs text-on-surface-variant">{total} tickets</p>
        
        {loading ? (
          <p className="py-10 text-center text-sm text-on-surface-variant">Loading support queue...</p>
        ) : (
          <AdminTable 
            columns={[
              { key: 'ticketNumber', label: 'Reference', render: (row) => <span className="font-mono text-xs font-semibold text-primary">{row.ticketNumber}</span> },
              { key: 'subject', label: 'Inquiry', render: (row) => <span><strong className="block font-medium text-on-surface">{row.subject}</strong><span className="text-xs">{row.patientName}</span></span> },
              { key: 'assignedStaffName', label: 'Assigned To', render: (row) => row.assignedStaffName || <span className="text-on-surface-variant italic">Unassigned</span> },
              { key: 'category', label: 'Category' },
              { key: 'status', label: 'Status', render: (row) => <StatusBadge status={row.status} /> },
              { key: 'updatedAt', label: 'Updated', render: (row) => formatAdminDate(row.updatedAt, { timeStyle: 'short' }) },
            ]} 
            rows={tickets} 
            renderActions={(row) => (
              <button type="button" onClick={() => setSelectedId(row.id)} className="font-semibold text-primary hover:underline">
                View
              </button>
            )} 
          />
        )}
        
        {total > limit && (
          <div className="mt-4 flex justify-between">
            <button type="button" disabled={!offset} onClick={() => setOffset(Math.max(0, offset - limit))} className="min-h-10 rounded-lg border border-slate-200 px-3 text-sm disabled:opacity-40">Previous</button>
            <span className="self-center text-sm text-on-surface-variant">{offset + 1}–{Math.min(offset + limit, total)} of {total}</span>
            <button type="button" disabled={offset + limit >= total} onClick={() => setOffset(offset + limit)} className="min-h-10 rounded-lg border border-slate-200 px-3 text-sm disabled:opacity-40">Next</button>
          </div>
        )}
      </AdminSection>
      
      {selectedId && (
        <TicketDialog 
          ticketId={selectedId} 
          onClose={() => setSelectedId('')} 
        />
      )}
    </>
  );
}