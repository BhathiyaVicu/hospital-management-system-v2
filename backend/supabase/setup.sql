CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS public.user_roles (
  role TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.user_roles (role, description)
VALUES
  ('patient', 'Patient account'),
  ('doctor', 'Doctor account'),
  ('staff', 'Support staff account'),
  ('receptionist', 'Receptionist account'),
  ('admin', 'Administrator account')
ON CONFLICT (role) DO UPDATE SET description = EXCLUDED.description;

CREATE TABLE IF NOT EXISTS public.clinics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  city TEXT NOT NULL,
  address TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.specialties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'patient' REFERENCES public.user_roles(role),
  password_hash TEXT,
  profile_phone TEXT,
  email_verified_at TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  is_super_admin BOOLEAN NOT NULL DEFAULT FALSE,
  must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.users
  ALTER COLUMN password_hash DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS is_super_admin BOOLEAN NOT NULL DEFAULT FALSE,
  DROP CONSTRAINT IF EXISTS users_super_admin_role_check,
  ADD CONSTRAINT users_super_admin_role_check CHECK (NOT is_super_admin OR role = 'admin');

CREATE TABLE IF NOT EXISTS public.patients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES public.users(id) ON DELETE CASCADE,
  phone TEXT,
  date_of_birth DATE,
  gender TEXT,
  blood_type TEXT,
  home_address TEXT,
  emergency_contact_name TEXT,
  emergency_contact_relationship TEXT,
  emergency_contact_phone TEXT,
  preferred_clinic_id UUID REFERENCES public.clinics(id) ON DELETE SET NULL,
  preferred_consultation_mode TEXT,
  preferred_language TEXT,
  wheelchair_accessible BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.doctors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES public.users(id) ON DELETE CASCADE,
  clinic_id UUID REFERENCES public.clinics(id) ON DELETE SET NULL,
  primary_specialty_id UUID REFERENCES public.specialties(id) ON DELETE RESTRICT,
  professional_title TEXT NOT NULL,
  bio TEXT NOT NULL DEFAULT '',
  years_of_experience INTEGER CHECK (years_of_experience IS NULL OR years_of_experience BETWEEN 0 AND 80),
  consultation_fee NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (consultation_fee >= 0),
  currency CHAR(3) NOT NULL DEFAULT 'LKR',
  profile_image_url TEXT,
  time_zone TEXT NOT NULL DEFAULT 'UTC',
  education TEXT NOT NULL DEFAULT '',
  languages TEXT[] NOT NULL DEFAULT '{}',
  approval_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (approval_status IN ('pending', 'approved', 'rejected')),
  is_accepting_appointments BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.doctors
  DROP COLUMN IF EXISTS rating,
  DROP COLUMN IF EXISTS review_count,
  ALTER COLUMN currency SET DEFAULT 'LKR';
UPDATE public.doctors SET currency = 'LKR' WHERE currency IS DISTINCT FROM 'LKR';

CREATE TABLE IF NOT EXISTS public.doctor_specialties (
  doctor_id UUID NOT NULL REFERENCES public.doctors(id) ON DELETE CASCADE,
  specialty_id UUID NOT NULL REFERENCES public.specialties(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (doctor_id, specialty_id)
);

ALTER TABLE public.doctors
  DROP CONSTRAINT IF EXISTS doctors_primary_specialty_id_fkey,
  ADD CONSTRAINT doctors_primary_specialty_id_fkey
    FOREIGN KEY (primary_specialty_id) REFERENCES public.specialties(id) ON DELETE RESTRICT;

ALTER TABLE public.doctor_specialties
  DROP CONSTRAINT IF EXISTS doctor_specialties_specialty_id_fkey,
  ADD CONSTRAINT doctor_specialties_specialty_id_fkey
    FOREIGN KEY (specialty_id) REFERENCES public.specialties(id) ON DELETE RESTRICT;

CREATE TABLE IF NOT EXISTS public.doctor_availability (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doctor_id UUID NOT NULL REFERENCES public.doctors(id) ON DELETE CASCADE,
  day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  slot_duration_minutes SMALLINT NOT NULL CHECK (slot_duration_minutes BETWEEN 10 AND 240),
  is_available BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_time > start_time)
);

CREATE TABLE IF NOT EXISTS public.doctor_availability_exceptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doctor_id UUID NOT NULL REFERENCES public.doctors(id) ON DELETE CASCADE,
  available_on DATE NOT NULL,
  start_time TIME,
  end_time TIME,
  slot_duration_minutes SMALLINT,
  is_available BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (slot_duration_minutes IS NULL OR slot_duration_minutes BETWEEN 10 AND 240),
  CHECK (
    (is_available AND start_time IS NOT NULL AND end_time IS NOT NULL
      AND slot_duration_minutes IS NOT NULL AND end_time > start_time)
    OR
    (NOT is_available AND start_time IS NULL AND end_time IS NULL
      AND slot_duration_minutes IS NULL)
  )
);

CREATE TABLE IF NOT EXISTS public.doctor_availability_date_schedules (
  doctor_id UUID NOT NULL REFERENCES public.doctors(id) ON DELETE CASCADE,
  available_on DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  slot_duration_minutes SMALLINT NOT NULL CHECK (slot_duration_minutes BETWEEN 10 AND 240),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (doctor_id, available_on),
  CHECK (end_time > start_time)
);

CREATE TABLE IF NOT EXISTS public.doctor_availability_date_slots (
  doctor_id UUID NOT NULL,
  available_on DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  is_available BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (doctor_id, available_on, start_time),
  FOREIGN KEY (doctor_id, available_on)
    REFERENCES public.doctor_availability_date_schedules (doctor_id, available_on) ON DELETE CASCADE,
  CHECK (end_time > start_time)
);

CREATE TABLE IF NOT EXISTS public.patient_clinics (
  patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  clinic_id UUID NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  created_by_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (patient_id, clinic_id)
);

CREATE TABLE IF NOT EXISTS public.receptionist_clinics (
  receptionist_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  clinic_id UUID NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (receptionist_user_id, clinic_id)
);

CREATE TABLE IF NOT EXISTS public.appointments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
  doctor_id UUID NOT NULL REFERENCES public.doctors(id) ON DELETE RESTRICT,
  scheduled_start TIMESTAMPTZ NOT NULL,
  scheduled_end TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'confirmed'
    CHECK (status IN ('confirmed', 'cancelled', 'completed')),
  workflow_status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (workflow_status IN ('scheduled', 'arrived', 'checked_in', 'waiting', 'in_consultation', 'completed', 'no_show')),
  reason TEXT,
  consultation_fee_snapshot NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (consultation_fee_snapshot >= 0),
  is_walk_in BOOLEAN NOT NULL DEFAULT FALSE,
  walk_in_reason TEXT,
  created_by_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  workflow_updated_by_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  workflow_updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  cancellation_actor_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (scheduled_end > scheduled_start),
  CHECK (NOT is_walk_in OR NULLIF(btrim(walk_in_reason), '') IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS public.appointment_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id UUID NOT NULL REFERENCES public.appointments(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  scheduled_start TIMESTAMPTZ NOT NULL,
  scheduled_end TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL,
  workflow_status TEXT NOT NULL,
  actor_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.appointment_workflow_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id UUID NOT NULL REFERENCES public.appointments(id) ON DELETE CASCADE,
  previous_status TEXT NOT NULL,
  new_status TEXT NOT NULL,
  actor_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (previous_status IN ('scheduled', 'arrived', 'checked_in', 'waiting', 'in_consultation', 'completed', 'no_show')),
  CHECK (new_status IN ('scheduled', 'arrived', 'checked_in', 'waiting', 'in_consultation', 'completed', 'no_show'))
);

CREATE TABLE IF NOT EXISTS public.consultations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id UUID NOT NULL UNIQUE REFERENCES public.appointments(id) ON DELETE CASCADE,
  doctor_id UUID NOT NULL REFERENCES public.doctors(id) ON DELETE RESTRICT,
  patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
  clinical_notes TEXT NOT NULL DEFAULT '',
  assessment TEXT NOT NULL DEFAULT '',
  treatment_plan TEXT NOT NULL DEFAULT '',
  follow_up_notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.consultation_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consultation_id UUID NOT NULL REFERENCES public.consultations(id) ON DELETE CASCADE,
  doctor_id UUID NOT NULL REFERENCES public.doctors(id) ON DELETE RESTRICT,
  clinical_notes TEXT NOT NULL DEFAULT '',
  assessment TEXT NOT NULL DEFAULT '',
  treatment_plan TEXT NOT NULL DEFAULT '',
  follow_up_notes TEXT NOT NULL DEFAULT '',
  revised_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.support_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_number TEXT NOT NULL UNIQUE,
  patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  assigned_staff_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  appointment_id UUID REFERENCES public.appointments(id) ON DELETE SET NULL,
  category TEXT NOT NULL CHECK (category IN ('feedback', 'complaint', 'inquiry')),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high')),
  subject TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'in_progress', 'waiting_for_patient', 'resolved', 'closed')),
  resolved_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.support_ticket_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  sender_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  message TEXT NOT NULL CHECK (length(btrim(message)) BETWEEN 1 AND 5000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.admin_activity_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  actor_role TEXT,
  target_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  attempted_email TEXT,
  event_type TEXT NOT NULL,
  success BOOLEAN NOT NULL DEFAULT TRUE,
  ip_address TEXT,
  user_agent TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.healthcare_services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  duration_minutes SMALLINT NOT NULL DEFAULT 30 CHECK (duration_minutes BETWEEN 10 AND 480),
  fee NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (fee >= 0),
  currency CHAR(3) NOT NULL DEFAULT 'LKR',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.clinic_services (
  clinic_id UUID NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  service_id UUID NOT NULL REFERENCES public.healthcare_services(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (clinic_id, service_id)
);

CREATE TABLE IF NOT EXISTS public.doctor_services (
  doctor_id UUID NOT NULL REFERENCES public.doctors(id) ON DELETE CASCADE,
  service_id UUID NOT NULL REFERENCES public.healthcare_services(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (doctor_id, service_id)
);

CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'general',
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  link TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key TEXT,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS dedupe_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS notifications_user_dedupe_key_idx
  ON public.notifications (user_id, dedupe_key);

DELETE FROM public.notifications AS notification
USING public.users AS account
WHERE notification.user_id = account.id
  AND account.role NOT IN ('patient', 'doctor', 'staff');

CREATE OR REPLACE FUNCTION public.enforce_notification_recipient_role()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  recipient_role TEXT;
BEGIN
  SELECT role INTO recipient_role
  FROM public.users
  WHERE id = NEW.user_id;

  IF recipient_role IS NULL OR recipient_role NOT IN ('patient', 'doctor', 'staff') THEN
    RAISE EXCEPTION 'Notifications are only available to patient, doctor, and staff accounts.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notifications_recipient_role_check ON public.notifications;
CREATE TRIGGER notifications_recipient_role_check
  BEFORE INSERT OR UPDATE OF user_id ON public.notifications
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_notification_recipient_role();

ALTER TABLE public.support_tickets
  DROP CONSTRAINT IF EXISTS support_tickets_assigned_staff_id_fkey,
  ADD CONSTRAINT support_tickets_assigned_staff_id_fkey
    FOREIGN KEY (assigned_staff_id) REFERENCES public.users(id) ON DELETE RESTRICT;

ALTER TABLE public.appointments
  DROP CONSTRAINT IF EXISTS appointments_created_by_user_id_fkey,
  DROP CONSTRAINT IF EXISTS appointments_updated_by_user_id_fkey,
  DROP CONSTRAINT IF EXISTS appointments_workflow_updated_by_user_id_fkey,
  DROP CONSTRAINT IF EXISTS appointments_cancellation_actor_user_id_fkey,
  ADD CONSTRAINT appointments_created_by_user_id_fkey
    FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON DELETE RESTRICT,
  ADD CONSTRAINT appointments_updated_by_user_id_fkey
    FOREIGN KEY (updated_by_user_id) REFERENCES public.users(id) ON DELETE RESTRICT,
  ADD CONSTRAINT appointments_workflow_updated_by_user_id_fkey
    FOREIGN KEY (workflow_updated_by_user_id) REFERENCES public.users(id) ON DELETE RESTRICT,
  ADD CONSTRAINT appointments_cancellation_actor_user_id_fkey
    FOREIGN KEY (cancellation_actor_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;

ALTER TABLE public.patient_clinics
  DROP CONSTRAINT IF EXISTS patient_clinics_created_by_user_id_fkey,
  ADD CONSTRAINT patient_clinics_created_by_user_id_fkey
    FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;

ALTER TABLE public.appointment_history
  DROP CONSTRAINT IF EXISTS appointment_history_actor_user_id_fkey,
  ADD CONSTRAINT appointment_history_actor_user_id_fkey
    FOREIGN KEY (actor_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;

ALTER TABLE public.appointment_workflow_history
  DROP CONSTRAINT IF EXISTS appointment_workflow_history_actor_user_id_fkey,
  ADD CONSTRAINT appointment_workflow_history_actor_user_id_fkey
    FOREIGN KEY (actor_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS patients_preferred_clinic_idx
  ON public.patients (preferred_clinic_id);
CREATE INDEX IF NOT EXISTS doctors_clinic_idx
  ON public.doctors (clinic_id);
CREATE INDEX IF NOT EXISTS doctors_primary_specialty_idx
  ON public.doctors (primary_specialty_id);
CREATE INDEX IF NOT EXISTS doctor_availability_lookup_idx
  ON public.doctor_availability (doctor_id, day_of_week, start_time);
CREATE INDEX IF NOT EXISTS doctor_availability_exceptions_lookup_idx
  ON public.doctor_availability_exceptions (doctor_id, available_on, created_at DESC);
CREATE INDEX IF NOT EXISTS doctor_availability_date_slots_open_idx
  ON public.doctor_availability_date_slots (doctor_id, available_on, start_time)
  WHERE is_available = TRUE;
CREATE INDEX IF NOT EXISTS patient_clinics_clinic_idx
  ON public.patient_clinics (clinic_id, patient_id);
CREATE INDEX IF NOT EXISTS receptionist_clinics_clinic_idx
  ON public.receptionist_clinics (clinic_id, receptionist_user_id);
CREATE INDEX IF NOT EXISTS appointments_doctor_start_idx
  ON public.appointments (doctor_id, scheduled_start);
CREATE INDEX IF NOT EXISTS appointments_report_start_idx
  ON public.appointments (scheduled_start);
CREATE INDEX IF NOT EXISTS appointments_report_cancellation_idx
  ON public.appointments (cancelled_at)
  WHERE status = 'cancelled' AND cancelled_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS appointments_patient_start_idx
  ON public.appointments (patient_id, scheduled_start DESC);
CREATE INDEX IF NOT EXISTS appointment_history_lookup_idx
  ON public.appointment_history (appointment_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS appointment_history_reschedule_date_idx
  ON public.appointment_history (changed_at)
  WHERE event_type = 'rescheduled';
CREATE INDEX IF NOT EXISTS appointment_workflow_history_lookup_idx
  ON public.appointment_workflow_history (appointment_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS support_tickets_patient_created_idx
  ON public.support_tickets (patient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS support_tickets_status_updated_idx
  ON public.support_tickets (status, updated_at DESC);
CREATE INDEX IF NOT EXISTS support_ticket_messages_lookup_idx
  ON public.support_ticket_messages (ticket_id, created_at);
CREATE INDEX IF NOT EXISTS admin_activity_logs_occurred_idx
  ON public.admin_activity_logs (occurred_at DESC);
CREATE INDEX IF NOT EXISTS notifications_user_unread_created_idx
  ON public.notifications (user_id, created_at DESC)
  WHERE read_at IS NULL;

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'users', 'clinics', 'specialties', 'patients', 'doctors',
    'doctor_availability', 'doctor_availability_exceptions',
    'doctor_availability_date_schedules', 'appointments', 'consultations',
    'support_tickets', 'healthcare_services'
  ]
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS set_updated_at ON public.%I', table_name);
    EXECUTE format(
      'CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()',
      table_name
    );
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_appointment_history()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  history_event TEXT;
  actor_id UUID;
BEGIN
  IF TG_OP = 'INSERT' THEN
    history_event := 'created';
    actor_id := NEW.created_by_user_id;
  ELSE
    IF NEW.scheduled_start IS DISTINCT FROM OLD.scheduled_start
      OR NEW.scheduled_end IS DISTINCT FROM OLD.scheduled_end THEN
      history_event := 'rescheduled';
    ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
      history_event := 'status_changed';
    ELSIF NEW.workflow_status IS DISTINCT FROM OLD.workflow_status THEN
      history_event := 'workflow_changed';
    ELSE
      history_event := 'updated';
    END IF;
    actor_id := COALESCE(NEW.cancellation_actor_user_id, NEW.updated_by_user_id, NEW.created_by_user_id);
  END IF;

  INSERT INTO public.appointment_history (
    appointment_id, event_type, scheduled_start, scheduled_end,
    status, workflow_status, actor_user_id
  )
  VALUES (
    NEW.id, history_event, NEW.scheduled_start, NEW.scheduled_end,
    NEW.status, NEW.workflow_status, actor_id
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS record_appointment_history ON public.appointments;
CREATE TRIGGER record_appointment_history
  AFTER INSERT OR UPDATE OF scheduled_start, scheduled_end, status, workflow_status
  ON public.appointments
  FOR EACH ROW
  EXECUTE FUNCTION public.record_appointment_history();

CREATE OR REPLACE FUNCTION public.mirror_auth_user_to_public()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.users (id, name, email, role, email_verified_at, is_active)
  VALUES (
    NEW.id,
    COALESCE(NULLIF(NEW.raw_user_meta_data ->> 'name', ''), split_part(NEW.email, '@', 1)),
    NEW.email,
    'patient',
    NEW.email_confirmed_at,
    TRUE
  )
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    email = EXCLUDED.email,
    email_verified_at = EXCLUDED.email_verified_at,
    updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_or_updated ON auth.users;
CREATE TRIGGER on_auth_user_created_or_updated
  AFTER INSERT OR UPDATE OF email, email_confirmed_at, raw_user_meta_data
  ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.mirror_auth_user_to_public();

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clinics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.specialties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.doctors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.doctor_specialties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.doctor_availability ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.doctor_availability_exceptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.doctor_availability_date_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.doctor_availability_date_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patient_clinics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.receptionist_clinics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointment_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointment_workflow_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consultations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consultation_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_ticket_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_activity_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.healthcare_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clinic_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.doctor_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT SELECT ON public.notifications TO authenticated;
GRANT UPDATE (read_at) ON public.notifications TO authenticated;

CREATE OR REPLACE FUNCTION public.can_access_notifications()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND role IN ('patient', 'doctor', 'staff')
  );
$$;

REVOKE ALL ON FUNCTION public.can_access_notifications() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_access_notifications() TO authenticated;

DROP POLICY IF EXISTS "Users can read their own notifications" ON public.notifications;
CREATE POLICY "Users can read their own notifications"
  ON public.notifications
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id AND public.can_access_notifications());

DROP POLICY IF EXISTS "Users can update their own notifications" ON public.notifications;
CREATE POLICY "Users can update their own notifications"
  ON public.notifications
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id AND public.can_access_notifications())
  WITH CHECK (auth.uid() = user_id AND public.can_access_notifications());
