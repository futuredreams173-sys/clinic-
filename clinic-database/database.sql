-- =====================================================================
--  قاعدة بيانات تجريبية: شبكة عيادات صحية (بيانات وهمية بالكامل)
--  للتدريب على ربط الجداول (Joins) وربط تطبيق بـ Supabase
--  طريقة التشغيل: انسخي الملف كاملاً في Supabase > SQL Editor ثم Run
--  ملاحظة: الملف يحذف الجداول بنفس الأسماء إن وجدت ثم يعيد إنشاءها
-- =====================================================================

drop view  if exists appointments_details;
drop table if exists appointments;
drop table if exists patients;
drop table if exists doctors;
drop table if exists departments;
drop table if exists hospitals;

-- ---------------------------------------------------------------------
-- 1) المستشفيات
-- ---------------------------------------------------------------------
create table hospitals (
  id          bigint generated always as identity primary key,
  name        text not null,
  city        text not null,
  type        text not null check (type in ('حكومي', 'خاص')),
  beds        int  not null check (beds > 0),
  phone       text,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 2) الأقسام (كل قسم يتبع مستشفى)  ← علاقة واحد إلى متعدد
-- ---------------------------------------------------------------------
create table departments (
  id           bigint generated always as identity primary key,
  hospital_id  bigint not null references hospitals(id) on delete cascade,
  name         text not null,
  floor        int,
  unique (hospital_id, name)
);

-- ---------------------------------------------------------------------
-- 3) الأطباء (كل طبيب يتبع قسماً)
-- ---------------------------------------------------------------------
create table doctors (
  id             bigint generated always as identity primary key,
  department_id  bigint not null references departments(id) on delete cascade,
  full_name      text not null,
  specialty      text not null,
  years_exp      int  not null default 0 check (years_exp >= 0),
  gender         text check (gender in ('ذكر', 'أنثى'))
);

-- ---------------------------------------------------------------------
-- 4) المرضى (أسماء وهمية — لا تضعي بيانات حقيقية)
-- ---------------------------------------------------------------------
create table patients (
  id          bigint generated always as identity primary key,
  full_name   text not null,
  gender      text check (gender in ('ذكر', 'أنثى')),
  birth_year  int  check (birth_year between 1920 and 2026),
  city        text,
  blood_type  text check (blood_type in ('A+','A-','B+','B-','AB+','AB-','O+','O-'))
);

-- ---------------------------------------------------------------------
-- 5) المواعيد (تربط المريض بالطبيب)  ← علاقة متعدد إلى متعدد
-- ---------------------------------------------------------------------
create table appointments (
  id           bigint generated always as identity primary key,
  patient_id   bigint not null references patients(id) on delete cascade,
  doctor_id    bigint not null references doctors(id)  on delete cascade,
  appt_date    date   not null,
  appt_time    time   not null,
  status       text   not null default 'مجدول'
               check (status in ('مجدول', 'مكتمل', 'ملغي', 'لم يحضر')),
  reason       text
);

create index on departments (hospital_id);
create index on doctors (department_id);
create index on appointments (patient_id);
create index on appointments (doctor_id);
create index on appointments (appt_date);

-- =====================================================================
--  البيانات
-- =====================================================================

insert into hospitals (name, city, type, beds, phone) values
  ('مستشفى الواحة العام',      'الطائف', 'حكومي', 350, '012-000-0001'),
  ('مستشفى الورد التخصصي',     'الطائف', 'خاص',   120, '012-000-0002'),
  ('مستشفى الهدا المركزي',     'الطائف', 'حكومي', 220, '012-000-0003'),
  ('مستشفى النخيل',            'جدة',    'خاص',   180, '012-000-0004');

insert into departments (hospital_id, name, floor) values
  (1, 'الطوارئ', 0), (1, 'الباطنية', 2), (1, 'الأطفال', 3), (1, 'النساء والولادة', 4),
  (2, 'الجلدية', 1), (2, 'العظام', 2),   (2, 'الأطفال', 3),
  (3, 'الطوارئ', 0), (3, 'القلب', 2),    (3, 'الباطنية', 3),
  (4, 'العيون', 1),  (4, 'العظام', 2),   (4, 'القلب', 3);

insert into doctors (department_id, full_name, specialty, years_exp, gender) values
  (1,  'د. سامي العتيبي',   'طب الطوارئ',        12, 'ذكر'),
  (1,  'د. ريم الحربي',     'طب الطوارئ',         6, 'أنثى'),
  (2,  'د. خالد الزهراني',  'باطنية',            15, 'ذكر'),
  (3,  'د. نورة القحطاني',  'طب الأطفال',         9, 'أنثى'),
  (4,  'د. هيا الشهري',     'نساء وولادة',       18, 'أنثى'),
  (5,  'د. ماجد الغامدي',   'جلدية',              7, 'ذكر'),
  (6,  'د. فهد المالكي',    'جراحة العظام',      20, 'ذكر'),
  (7,  'د. سارة الثبيتي',   'طب الأطفال',         4, 'أنثى'),
  (8,  'د. عبدالله السبيعي','طب الطوارئ',        10, 'ذكر'),
  (9,  'د. لمى الدوسري',    'أمراض القلب',       13, 'أنثى'),
  (10, 'د. تركي الشمري',    'باطنية',             8, 'ذكر'),
  (11, 'د. أمل الجهني',     'طب العيون',         11, 'أنثى'),
  (12, 'د. يوسف البقمي',    'جراحة العظام',       5, 'ذكر'),
  (13, 'د. منى السلمي',     'أمراض القلب',       16, 'أنثى');

insert into patients (full_name, gender, birth_year, city, blood_type) values
  ('مريض تجريبي 01 - علي',    'ذكر',  1985, 'الطائف', 'O+'),
  ('مريضة تجريبية 02 - فاطمة','أنثى', 1992, 'الطائف', 'A+'),
  ('مريض تجريبي 03 - محمد',   'ذكر',  1970, 'الطائف', 'B+'),
  ('مريضة تجريبية 04 - مريم', 'أنثى', 2015, 'الطائف', 'O-'),
  ('مريض تجريبي 05 - عمر',    'ذكر',  1958, 'جدة',    'AB+'),
  ('مريضة تجريبية 06 - هند',  'أنثى', 1988, 'الطائف', 'A-'),
  ('مريض تجريبي 07 - سعد',    'ذكر',  2019, 'الطائف', 'O+'),
  ('مريضة تجريبية 08 - جود',  'أنثى', 2001, 'جدة',    'B-'),
  ('مريض تجريبي 09 - ناصر',   'ذكر',  1965, 'الطائف', 'A+'),
  ('مريضة تجريبية 10 - دانة', 'أنثى', 1996, 'الطائف', 'O+'),
  ('مريض تجريبي 11 - بدر',    'ذكر',  1979, 'جدة',    'AB-'),
  ('مريضة تجريبية 12 - شهد',  'أنثى', 2010, 'الطائف', 'B+');

insert into appointments (patient_id, doctor_id, appt_date, appt_time, status, reason) values
  (1,  3,  '2026-10-01', '09:00', 'مكتمل',   'متابعة ضغط الدم'),
  (2,  5,  '2026-10-02', '10:30', 'مكتمل',   'متابعة حمل'),
  (3,  10, '2026-10-03', '11:00', 'مكتمل',   'ألم في الصدر'),
  (4,  4,  '2026-10-05', '08:30', 'مكتمل',   'تطعيمات'),
  (5,  14, '2026-10-06', '13:00', 'لم يحضر', 'متابعة قلب'),
  (6,  6,  '2026-10-08', '16:00', 'مكتمل',   'حساسية جلدية'),
  (7,  8,  '2026-10-09', '09:30', 'ملغي',    'حرارة'),
  (8,  12, '2026-10-12', '12:00', 'مكتمل',   'فحص نظر'),
  (9,  11, '2026-10-14', '10:00', 'مكتمل',   'متابعة سكري'),
  (10, 7,  '2026-10-15', '15:30', 'مكتمل',   'ألم الركبة'),
  (1,  10, '2026-10-20', '11:30', 'مكتمل',   'تخطيط قلب'),
  (11, 13, '2026-10-22', '14:00', 'ملغي',    'كسر في اليد'),
  (12, 4,  '2026-10-28', '09:00', 'مجدول',   'كشف دوري'),
  (2,  5,  '2026-10-30', '10:30', 'مجدول',   'متابعة حمل'),
  (3,  3,  '2026-11-02', '08:00', 'مجدول',   'نتائج تحاليل'),
  (6,  6,  '2026-11-03', '16:30', 'مجدول',   'مراجعة'),
  (9,  11, '2026-11-05', '10:00', 'مجدول',   'متابعة سكري'),
  (10, 1,  '2026-11-06', '20:00', 'مجدول',   'إصابة رياضية');

-- =====================================================================
--  View جاهز: كل موعد مع اسم المريض والطبيب والقسم والمستشفى
--  (مثال على ربط 5 جداول — يمكن قراءته من التطبيق مثل أي جدول)
-- =====================================================================
create view appointments_details
with (security_invoker = true) as
select
  a.id            as appointment_id,
  a.appt_date,
  a.appt_time,
  a.status,
  a.reason,
  p.full_name     as patient_name,
  d.full_name     as doctor_name,
  d.specialty,
  dep.name        as department,
  h.name          as hospital,
  h.city
from appointments a
join patients    p   on p.id   = a.patient_id
join doctors     d   on d.id   = a.doctor_id
join departments dep on dep.id = d.department_id
join hospitals   h   on h.id   = dep.hospital_id;

-- =====================================================================
--  الصلاحيات (RLS): السماح بالقراءة فقط للجميع — مناسب للتجربة فقط
--  لأن البيانات وهمية. في مشروع حقيقي لا تفتحي جدول المرضى للعامة.
-- =====================================================================
alter table hospitals    enable row level security;
alter table departments  enable row level security;
alter table doctors      enable row level security;
alter table patients     enable row level security;
alter table appointments enable row level security;

create policy "read hospitals"    on hospitals    for select using (true);
create policy "read departments"  on departments  for select using (true);
create policy "read doctors"      on doctors      for select using (true);
create policy "read patients"     on patients     for select using (true);
create policy "read appointments" on appointments for select using (true);
