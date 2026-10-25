-- =====================================================================
--  تمارين ربط الجداول — شغّلي كل استعلام لوحده في SQL Editor
-- =====================================================================

-- 1) كل قسم مع اسم المستشفى التابع له (ربط جدولين)
select h.name as hospital, d.name as department, d.floor
from departments d
join hospitals h on h.id = d.hospital_id
order by h.name, d.floor;

-- 2) الأطباء مع أقسامهم ومستشفياتهم (ربط 3 جداول)
select doc.full_name, doc.specialty, dep.name as department, h.name as hospital
from doctors doc
join departments dep on dep.id = doc.department_id
join hospitals   h   on h.id   = dep.hospital_id
order by h.name;

-- 3) عدد المواعيد لكل طبيب (ربط + تجميع)
select doc.full_name, count(a.id) as total_appointments
from doctors doc
left join appointments a on a.doctor_id = doc.id
group by doc.full_name
order by total_appointments desc;

-- 4) الأطباء الذين ليس لديهم أي موعد (LEFT JOIN + IS NULL)
select doc.full_name
from doctors doc
left join appointments a on a.doctor_id = doc.id
where a.id is null;

-- 5) نسبة عدم الحضور والإلغاء لكل مستشفى
select h.name as hospital,
       count(*) as total,
       count(*) filter (where a.status in ('ملغي','لم يحضر')) as missed,
       round(100.0 * count(*) filter (where a.status in ('ملغي','لم يحضر')) / count(*), 1) as missed_pct
from appointments a
join doctors     doc on doc.id = a.doctor_id
join departments dep on dep.id = doc.department_id
join hospitals   h   on h.id   = dep.hospital_id
group by h.name;

-- 6) المواعيد القادمة (من الـ View الجاهز)
select * from appointments_details
where status = 'مجدول'
order by appt_date, appt_time;

-- 7) تمرين لك: اكتبي استعلاماً يعرض عدد المرضى في كل فئة عمرية
--    (أطفال أقل من 14، بالغين 14-59، كبار 60+) — استخدمي CASE
