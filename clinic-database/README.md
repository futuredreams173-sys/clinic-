# قاعدة بيانات تجريبية: شبكة عيادات صحية

قاعدة بيانات صغيرة بالعربي للتدريب على **ربط الجداول** و**ربط تطبيق ويب بـ Supabase**.
⚠️ كل البيانات **وهمية** — لا تضيفي بيانات مرضى حقيقية.

## الجداول والعلاقات

```
hospitals (المستشفيات)
   └── departments (الأقسام)        hospital_id → hospitals.id
          └── doctors (الأطباء)      department_id → departments.id
                 └── appointments (المواعيد) doctor_id → doctors.id
patients (المرضى) ──┘                patient_id → patients.id
```

| الجدول | عدد الصفوف |
|---|---|
| hospitals | 4 |
| departments | 13 |
| doctors | 14 |
| patients | 12 |
| appointments | 18 |

وفيه **View** جاهز اسمه `appointments_details` يربط الجداول الخمسة في نتيجة واحدة.

## الملفات

| الملف | الوظيفة |
|---|---|
| `database.sql` | إنشاء الجداول + البيانات + الصلاحيات |
| `practice-queries.sql` | تمارين على الربط (Joins) |
| `index.html` | صفحة تعرض المواعيد من Supabase |

## طريقة التشغيل

1. أنشئي مشروعاً في [Supabase](https://supabase.com).
2. افتحي **SQL Editor** → الصقي محتوى `database.sql` → **Run**.
3. تأكدي من ظهور الجداول في **Table Editor**.
4. من **Project Settings → API** انسخي `Project URL` و `anon key`.
5. ضعيهما في `index.html` مكان `YOUR-PROJECT` و `YOUR-ANON-KEY`.
6. افتحي `index.html` في المتصفح.

## ملاحظة أمان

الصلاحيات في الملف تسمح **بالقراءة فقط** للجميع لأن البيانات وهمية.
مفتاح `anon` مصمم ليكون في الواجهة، لكن **لا تضعي أبداً مفتاح `service_role`** في أي ملف على GitHub.
