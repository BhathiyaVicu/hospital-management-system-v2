import { useEffect, useMemo, useState } from 'react';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import PortalHeading from '../components/common/PortalHeading';
import { AdminBarList, AdminTrendChart } from '../components/admin/AdminCharts';
import { AdminNotice, AdminSection, AdminStatCard, AdminTable, formatAdminDate } from '../components/admin/AdminComponents';
import { getAdminReportLookups, getAdminReports } from '../services/api';

const reportToday = new Date();
const reportRangeStart = new Date(reportToday);
reportRangeStart.setDate(reportToday.getDate() - 29);

const reportLabels = {
  appointments: 'Appointment report',
  'service-trends': 'Specialty and service trends',
  'clinic-activity': 'Clinic activity report',
  operational: 'Operational report',
};

function csvCell(value) {
  const text = String(value ?? '');
  const protectedText = /^[\s]*[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${protectedText.replaceAll('"', '""')}"`;
}

function downloadCsv(title, columns, rows) {
  const content = [columns.map((column) => column.label), ...rows.map((row) => columns.map((column) => row[column.key]))]
    .map((row) => row.map(csvCell).join(',')).join('\r\n');
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `mediconnect-${title.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-')}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function addPdfChart(doc, title, values, labelKey = 'label', valueKey = 'count', chartType = 'bar') {
  if (!values.length) return doc.lastAutoTable?.finalY ? doc.lastAutoTable.finalY + 10 : 35;
  
  let y = doc.lastAutoTable?.finalY ? doc.lastAutoTable.finalY + 12 : 35;
  if (y > 120) {
    doc.addPage();
    y = 24;
  }

  doc.setFontSize(12);
  doc.setTextColor(25, 54, 51);
  doc.text(title, 14, y);

  const chartTop = y + 10;
  const chartWidth = 180; // Use full width available
  const chartHeight = 60; 
  const chartX = 50; // Start X (leaves room for labels)

  const maxValue = Math.max(1, ...values.map((item) => Number(item[valueKey] || 0)));

  if (chartType === 'trend') {
    // Draw Axes for Trend Chart
    doc.setDrawColor(200, 200, 200);
    doc.setLineWidth(0.3);
    doc.line(chartX, chartTop, chartX, chartTop + chartHeight);
    doc.line(chartX, chartTop + chartHeight, chartX + chartWidth, chartTop + chartHeight);

    const gridLines = 4;
    doc.setFontSize(7);
    
    // Grid & Y-Axis Labels
    for (let i = 0; i <= gridLines; i++) {
      const gridY = chartTop + chartHeight - (chartHeight / gridLines) * i;
      doc.setDrawColor(240, 240, 240);
      doc.line(chartX, gridY, chartX + chartWidth, gridY);
      
      const val = Math.round((maxValue / gridLines) * i);
      doc.setTextColor(150, 150, 150);
      doc.text(String(val), chartX - 3, gridY + 2, { align: 'right' });
    }

    // Points
    const points = values.map((item, index) => ({
      x: chartX + (values.length < 2 ? 0 : (index / (values.length - 1)) * chartWidth),
      y: chartTop + chartHeight - ((Number(item[valueKey]) || 0) / maxValue) * chartHeight,
      label: String(item[labelKey]),
    }));

    // Fill Area
    doc.setFillColor(0, 104, 95, 0.1); 
    for (let i = 0; i < points.length - 1; i++) {
      doc.triangle(points[i].x, points[i].y, points[i].x, chartTop + chartHeight, points[i+1].x, chartTop + chartHeight, 'F');
      doc.triangle(points[i].x, points[i].y, points[i+1].x, points[i+1].y, points[i+1].x, chartTop + chartHeight, 'F');
    }

    // Line & Dots
    doc.setDrawColor(0, 104, 95);
    doc.setLineWidth(0.8);
    for (let i = 1; i < points.length; i++) {
      doc.line(points[i - 1].x, points[i - 1].y, points[i].x, points[i].y);
    }
    doc.setFillColor(0, 104, 95);
    points.forEach(p => doc.circle(p.x, p.y, 0.8, 'F'));

    // X-Axis Labels
    doc.setTextColor(100, 100, 100);
    if (values.length > 0) {
      doc.text(points[0].label, points[0].x, chartTop + chartHeight + 6, { align: 'center' });
      doc.text(points[Math.floor(points.length / 2)].label, points[Math.floor(points.length / 2)].x, chartTop + chartHeight + 6, { align: 'center' });
      doc.text(points[points.length - 1].label, points[points.length - 1].x, chartTop + chartHeight + 6, { align: 'center' });
    }
    return chartTop + chartHeight + 12;
  }

  // --- BAR CHART ---
  // Removed the grid lines and Y-axis numbers to make it a clean list.
  
  const maxBars = Math.min(values.length, 10);
  const rowHeight = chartHeight / maxBars;
  const barThickness = rowHeight * 0.6;

  values.slice(0, maxBars).forEach((item, index) => {
    const barY = chartTop + chartHeight - (index + 1) * rowHeight + (rowHeight - barThickness) / 2;
    const barWidth = (Number(item[valueKey]) / maxValue) * chartWidth;
    const label = String(item[labelKey] ?? '').replaceAll('_', ' ').slice(0, 20);

    // Label (left)
    doc.setFontSize(8);
    doc.setTextColor(65, 81, 78);
    doc.text(label, chartX - 3, barY + barThickness / 2 + 2, { align: 'right' });

    // Bar
    doc.setFillColor(0, 104, 95);
    if (barWidth > 0.5) {
      doc.rect(chartX, barY, barWidth, barThickness, 'F');
    }

    // Value text (right of bar)
    doc.setTextColor(25, 54, 51);
    doc.text(String(item[valueKey]), chartX + barWidth + 2, barY + barThickness / 2 + 2);
  });

  return chartTop + chartHeight + 10;
}

function exportPdf(filters, reports, view, lookups) {
  const doc = new jsPDF({ orientation: 'landscape' });
  doc.setFontSize(18);
  doc.setTextColor(0, 104, 95);
  doc.text('MediConnect', 14, 16);
  doc.setFontSize(14);
  doc.setTextColor(25, 54, 51);
  doc.text(reportLabels[filters.reportType], 14, 25);
  doc.setFontSize(9);
  doc.setTextColor(80, 95, 92);
  doc.text(`Period: ${filters.from} to ${filters.to} · Grouping: ${filters.grouping} · Generated: ${new Date().toLocaleString()}`, 14, 31);
  const selectedFilters = [
    filters.clinicId && `Clinic: ${lookups.clinics.find((item) => item.id === filters.clinicId)?.name || 'Selected clinic'}`,
    filters.specialtyId && `Specialty: ${lookups.specialties.find((item) => item.id === filters.specialtyId)?.name || 'Selected specialty'}`,
    filters.doctorId && `Doctor: ${lookups.doctors.find((item) => item.id === filters.doctorId)?.name || 'Selected doctor'}`,
    filters.status && `Outcome: ${filters.status.replaceAll('_', ' ')}`,
  ].filter(Boolean);
  const filterLines = doc.splitTextToSize(
    `Filters: ${selectedFilters.length ? selectedFilters.join(' · ') : 'All clinics, specialties, doctors, and outcomes'}`,
    268,
  );
  doc.text(filterLines, 14, 37);
  const summaryStartY = 37 + filterLines.length * 4 + 3;
  const summaryRows = [
    ['Appointments', reports.summary.total],
    ['Completed', reports.summary.completed],
    ['Pending', reports.summary.pending],
    ['Cancelled', reports.summary.cancelled],
    ['Rescheduled', reports.summary.rescheduled],
    ['No-show', reports.summary.noShow],
  ];
  autoTable(doc, {
    startY: summaryStartY, head: [['Metric', 'Count']], body: summaryRows,
    theme: 'grid', styles: { fontSize: 8 }, headStyles: { fillColor: [0, 104, 95] },
    margin: { left: 14, right: 14 },
  });
  const chartBottom = addPdfChart(
    doc, view.chart.title, view.chart.rows,
    view.chart.labelKey, view.chart.valueKey, view.chart.type,
  );
  if (filters.reportType === 'appointments') {
    autoTable(doc, {
      startY: Math.max(doc.lastAutoTable.finalY + 10, chartBottom),
      head: [view.columns.map((column) => column.label)],
      body: view.rows.map((row) => view.columns.map((column) => String(row[column.key] ?? '—'))),
      theme: 'striped', styles: { fontSize: 7 }, headStyles: { fillColor: [0, 104, 95] },
      margin: { left: 14, right: 14 },
    });
  } else {
    autoTable(doc, {
      startY: Math.max(doc.lastAutoTable.finalY + 10, chartBottom),
      head: [view.columns.map((column) => column.label)],
      body: view.rows.map((row) => view.columns.map((column) => String(row[column.key] ?? '—'))),
      theme: 'striped', styles: { fontSize: 8 }, headStyles: { fillColor: [0, 104, 95] },
      margin: { left: 14, right: 14 },
    });
  }
  if (filters.reportType === 'service-trends' && !reports.serviceUsageSupported) {
    doc.addPage();
    doc.setFontSize(10);
    doc.setTextColor(70, 70, 70);
    const noteLines = doc.splitTextToSize(reports.serviceUsageNote, 260);
    doc.text(noteLines, 14, 22);
  }
  const pageCount = doc.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page);
    doc.setFontSize(8);
    doc.setTextColor(110, 110, 110);
    doc.text(`Page ${page} of ${pageCount}`, 280, 200, { align: 'right' });
  }
  doc.save(`mediconnect-${filters.reportType}-${filters.from}-${filters.to}.pdf`);
}

function selectClass() {
  return 'mt-1.5 h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-on-surface';
}

export default function AdminReportsPage() {
  const [filters, setFilters] = useState({
    from: reportRangeStart.toISOString().slice(0, 10),
    to: reportToday.toISOString().slice(0, 10),
    reportType: 'appointments',
    grouping: 'daily',
    clinicId: '',
    specialtyId: '',
    doctorId: '',
    status: '',
  });
  const [appliedFilters, setAppliedFilters] = useState(filters);
  const [reports, setReports] = useState(null);
  const [lookups, setLookups] = useState({ clinics: [], specialties: [], doctors: [] });
  const [loading, setLoading] = useState(true);
  const [lookupsLoading, setLookupsLoading] = useState(true);
  const [reportError, setReportError] = useState('');
  const [lookupsError, setLookupsError] = useState('');

  useEffect(() => {
    let active = true;
    getAdminReportLookups()
      .then(({ data }) => { if (active) setLookups(data); })
      .catch((requestError) => { if (active) setLookupsError(requestError.message || 'Unable to load report filters.'); })
      .finally(() => { if (active) setLookupsLoading(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    getAdminReports(appliedFilters)
      .then(({ data }) => { if (active) { setReports(data); setReportError(''); } })
      .catch((requestError) => { if (active) setReportError(requestError.message || 'Unable to load reports.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [appliedFilters]);

  const groupingLabel = appliedFilters.grouping === 'daily'
    ? 'day'
    : appliedFilters.grouping === 'weekly' ? 'week' : 'month';
  const view = useMemo(() => {
    if (!reports) return null;
    if (appliedFilters.reportType === 'appointments') {
      const columns = [
        { key: 'scheduledStart', label: 'Scheduled' },
        { key: 'doctorName', label: 'Doctor' },
        { key: 'specialtyName', label: 'Specialty' },
        { key: 'clinicName', label: 'Clinic' },
        { key: 'status', label: 'Status' },
        { key: 'consultationType', label: 'Visit type' },
      ];
      return {
        rows: reports.appointmentRows,
        columns,
        chart: { title: `Appointments by ${groupingLabel} period`, rows: reports.appointmentTrend, labelKey: 'period', valueKey: 'count', type: 'trend' },
      };
    }
    if (appliedFilters.reportType === 'service-trends') {
      const rows = reports.appointmentsBySpecialty.map((item) => ({ specialtyName: item.name, appointments: item.total }));
      return {
        rows,
        columns: [{ key: 'specialtyName', label: 'Specialty' }, { key: 'appointments', label: 'Appointments' }],
        chart: { title: 'Appointments by specialty', rows, labelKey: 'specialtyName', valueKey: 'appointments' },
      };
    }
    if (appliedFilters.reportType === 'clinic-activity') {
      const rows = reports.appointmentsByClinic;
      return {
        rows,
        columns: [
          { key: 'name', label: 'Clinic' }, { key: 'total', label: 'Appointments' },
          { key: 'completed', label: 'Completed' }, { key: 'cancelled', label: 'Cancelled' },
          { key: 'pending', label: 'Pending' }, { key: 'noShow', label: 'No-show' },
        ],
        chart: { title: 'Appointments by clinic', rows, labelKey: 'name', valueKey: 'total' },
      };
    }
    const rows = reports.appointmentsByStatus;
    return {
      rows,
      columns: [{ key: 'status', label: 'Workflow outcome' }, { key: 'count', label: 'Appointments' }],
      chart: { title: 'Operational status', rows, labelKey: 'status', valueKey: 'count' },
    };
  }, [groupingLabel, appliedFilters.reportType, reports]);

  const updateFilter = (key, value) => setFilters((current) => ({
    ...current,
    [key]: value,
    ...(['clinicId', 'specialtyId'].includes(key) ? { doctorId: '' } : {}),
  }));
  const doctors = lookups.doctors.filter((doctor) => (
    (!filters.clinicId || doctor.clinicId === filters.clinicId)
    && (!filters.specialtyId || doctor.primarySpecialtyId === filters.specialtyId)
  ));
  const applyFilters = (event) => {
    event.preventDefault();
    setReportError('');
    setLoading(true);
    setAppliedFilters({ ...filters });
  };
  const exportRows = view?.rows || [];

  return (
    <>
      <PortalHeading
        eyebrow="Network intelligence"
        title="Reports & Analytics"
        description="Preview filtered appointment, specialty, clinic, and operational reports, then export a shareable PDF."
        actions={reports && view && (
          <>
            <button type="button" onClick={() => downloadCsv(reportLabels[appliedFilters.reportType], view.columns, exportRows)} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-200 px-4 text-sm font-semibold text-on-surface hover:bg-surface-container">
              <span className="material-symbols-outlined text-lg">download</span>Export CSV
            </button>
            <button type="button" onClick={() => exportPdf(appliedFilters, reports, view, lookups)} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-on-primary">
              <span className="material-symbols-outlined text-lg">picture_as_pdf</span>Export PDF
            </button>
          </>
        )}
      />
      {(lookupsError || reportError) && <AdminNotice>{lookupsError || reportError}</AdminNotice>}
      <AdminSection title="Report scope" description="Choose a range up to 12 months and refine the report by clinic, doctor, specialty, and appointment outcome.">
        <form onSubmit={applyFilters}>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <label className="text-xs font-medium text-on-surface-variant">Report type
              <select value={filters.reportType} onChange={(event) => updateFilter('reportType', event.target.value)} className={selectClass()}>
                {Object.entries(reportLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label className="text-xs font-medium text-on-surface-variant">From
              <input type="date" value={filters.from} max={filters.to} onChange={(event) => updateFilter('from', event.target.value)} className={selectClass()} />
            </label>
            <label className="text-xs font-medium text-on-surface-variant">To
              <input type="date" value={filters.to} min={filters.from} onChange={(event) => updateFilter('to', event.target.value)} className={selectClass()} />
            </label>
            <label className="text-xs font-medium text-on-surface-variant">Group by
              <select value={filters.grouping} onChange={(event) => updateFilter('grouping', event.target.value)} className={selectClass()}>
                <option value="daily">Day</option><option value="weekly">Week</option><option value="monthly">Month</option>
              </select>
            </label>
            <label className="text-xs font-medium text-on-surface-variant">Clinic
              <select value={filters.clinicId} onChange={(event) => updateFilter('clinicId', event.target.value)} className={selectClass()}>
                <option value="">All clinics</option>
                {lookups.clinics.map((clinic) => <option key={clinic.id} value={clinic.id}>{clinic.name}{clinic.isActive ? '' : ' (inactive)'}</option>)}
              </select>
            </label>
            <label className="text-xs font-medium text-on-surface-variant">Specialty
              <select value={filters.specialtyId} onChange={(event) => updateFilter('specialtyId', event.target.value)} className={selectClass()}>
                <option value="">All specialties</option>
                {lookups.specialties.map((specialty) => <option key={specialty.id} value={specialty.id}>{specialty.name}</option>)}
              </select>
            </label>
            <label className="text-xs font-medium text-on-surface-variant">Doctor
              <select value={filters.doctorId} onChange={(event) => updateFilter('doctorId', event.target.value)} className={selectClass()}>
                <option value="">All doctors</option>
                {doctors.map((doctor) => <option key={doctor.id} value={doctor.id}>{doctor.name}</option>)}
              </select>
            </label>
            <label className="text-xs font-medium text-on-surface-variant">Appointment outcome
              <select value={filters.status} onChange={(event) => updateFilter('status', event.target.value)} className={selectClass()}>
                <option value="">All outcomes</option><option value="confirmed">Confirmed</option><option value="completed">Completed</option>
                <option value="cancelled">Cancelled</option><option value="no_show">No-show</option>
              </select>
            </label>
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-on-surface-variant">{formatAdminDate(filters.from)} — {formatAdminDate(filters.to)}</p>
            <button type="submit" disabled={loading || lookupsLoading} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-on-primary disabled:opacity-60">
              <span className="material-symbols-outlined text-lg">filter_alt</span>{loading ? 'Generating...' : 'Apply filters'}
            </button>
          </div>
        </form>
      </AdminSection>
      {loading && !reports ? <p className="py-12 text-center text-on-surface-variant">Generating reports...</p> : reports && view && (
        <div className="mt-5 space-y-5 min-w-0">
          <section aria-label="Appointment totals" className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
            <AdminStatCard label="Appointments" value={reports.summary.total} icon="event" />
            <AdminStatCard label="Completed" value={reports.summary.completed} icon="task_alt" accent="blue" />
            <AdminStatCard label="Pending" value={reports.summary.pending} icon="pending_actions" accent="amber" />
            <AdminStatCard label="Cancelled" value={reports.summary.cancelled} icon="event_busy" accent="rose" />
            <AdminStatCard label="Rescheduled" value={reports.summary.rescheduled} icon="event_repeat" accent="blue" />
            <AdminStatCard label="No-show" value={reports.summary.noShow} icon="person_off" accent="amber" />
          </section>
          {appliedFilters.reportType === 'service-trends' && (
            <AdminNotice type="info">{reports.serviceUsageNote}</AdminNotice>
          )}
          
          {/* 👇 FIXED GRID & CHART OVERFLOW HERE 👇 */}
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
            <AdminSection title={view.chart.title} description="Counts are based on scheduled appointment start times in the selected date range.">
              <div className="min-w-0 w-full overflow-hidden">
                <AdminTrendChart title={`${groupingLabel[0].toUpperCase()}${groupingLabel.slice(1)} appointment volume`} data={reports.appointmentTrend} grouping={appliedFilters.grouping} />
                {appliedFilters.reportType === 'service-trends' && <div className="mt-6"><AdminBarList title="Appointments by specialty" rows={reports.appointmentsBySpecialty} labelKey="name" valueKey="total" /></div>}
                {appliedFilters.reportType === 'operational' && (
                  <div className="mt-6 grid gap-6 md:grid-cols-2">
                    <AdminBarList title="Visit type" rows={reports.consultationTypes} labelKey="type" />
                    <AdminBarList title="Appointment outcome" rows={reports.appointmentsByStatus} labelKey="status" />
                  </div>
                )}
                {appliedFilters.reportType === 'clinic-activity' && <div className="mt-6"><AdminBarList title="Appointments by clinic" rows={reports.appointmentsByClinic} labelKey="name" valueKey="total" /></div>}
                {appliedFilters.reportType === 'operational' && (
                  <div className="mt-6 grid gap-6 md:grid-cols-2">
                    <AdminTrendChart title="Cancellations" data={reports.cancellationTrend} grouping={appliedFilters.grouping} />
                    <AdminTrendChart title="Reschedules" data={reports.rescheduleTrend} grouping={appliedFilters.grouping} />
                  </div>
                )}
              </div>
            </AdminSection>
            <AdminSection title={reportLabels[appliedFilters.reportType]} description={`Filtered results · ${formatAdminDate(appliedFilters.from)} — ${formatAdminDate(appliedFilters.to)}`}>
              <div className="min-w-0 w-full overflow-x-auto">
                <AdminTable columns={view.columns} rows={view.rows} />
              </div>
            </AdminSection>
          </div>
          
          {appliedFilters.reportType === 'service-trends' && (
            <AdminSection title="Specialty activity over time" description={`Appointments grouped by ${appliedFilters.grouping} period and doctors' primary specialty.`}>
              <AdminTable columns={[{ key: 'period', label: 'Period' }, { key: 'specialtyName', label: 'Specialty' }, { key: 'count', label: 'Appointments' }]} rows={reports.specialtyTrend} />
            </AdminSection>
          )}
        </div>
      )}
    </>
  );
}