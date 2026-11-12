# كتشنيلي وورك (Kitchenly Work)

منصة شغل جماعي: محرر كود لحظي (Monaco + Yjs)، تاسكات Kanban، شات، رومات صوتية دائمة، ميتنج فيديو، وربط GitHub.

**Stack:** Next.js 16 (App Router) · Supabase (Auth + Postgres + Realtime + Presence) · Yjs + Monaco · LiveKit

## التشغيل

### 1) Supabase
1. اعمل مشروع.
2. شغّل الـ migrations **بالترتيب** (SQL Editor أو `supabase db push`):
   `001_init` → `002_security` → `003_tasks` → `004_chat_voice` → `005_github` → `006_notifications_history_search`
3. **Authentication → URL Configuration**: ضيف `http://localhost:3000/auth/callback` (وعنوان موقعك بعد النشر) في Redirect URLs.
4. **Authentication → Providers**: الإيميل (Magic Link) شغّال افتراضيًا. GitHub اختياري (محتاج OAuth App لتسجيل الدخول، مختلف عن اللي تحت).
5. **Realtime → Settings**: اقفل **Allow public access** عشان القنوات تبقى private بس (وده اللي بيفعّل سياسات `realtime.messages`).
6. تأكد إن RLS شغّال على `realtime.messages` (Realtime → Policies).

### 2) LiveKit
اعمل مشروع على cloud.livekit.io وخد الـ URL والـ API key/secret.

### 3) البيئة
```bash
cp .env.example .env.local   # واملأه
```
- مفيش أي مفتاح في الكود. `SUPABASE_SERVICE_ROLE_KEY` و`LIVEKIT_API_SECRET` و`GITHUB_CLIENT_SECRET` و`GITHUB_TOKEN_ENC_KEY` للسيرفر بس (من غير `NEXT_PUBLIC_`).
- **ما تحطّش مفاتيح LiveKit في الداتا بيز.** مكانها `.env.local` (وإعدادات المشروع على Vercel).
- لـ GitHub: اعمل OAuth App، الـ Callback = `<موقعك>/api/github/callback`، وولّد المفتاح بـ `openssl rand -base64 32`.

### 4) تشغيل
```bash
npm install
npm run dev
```
سجّل دخول بالإيميل، اعمل غرفة، ومن "الأعضاء والدعوات" انسخ لينك الدعوة لزمايلك.

## اللي اتضاف

**1. الأمان**
- Supabase Auth (Magic Link + GitHub اختياري) وحماية الصفحات بـ `proxy.ts`.
- جداول `profiles` و`rooms` و`room_members` و`room_invites` و`room_bans`، والـ `files` مربوط بـ `room_id`.
- RLS بالعضوية على كل الجداول، والسياسات المفتوحة اتمسحت (`002_security.sql`). `001_init.sql` ما اتعدّلش.
- دعوة بلينك فيه توكن (صلاحية 7 أيام، حد أقصى للاستخدام، إلغاء). الـ owner يشيل عضو، والمشال ما يقدرش يرجع بنفس اللينك.
- قنوات Realtime (presence و Yjs) **private** وسياسات على `realtime.messages` حسب `room:<room_id>:…`.
- توكن LiveKit بيتطلع بعد التحقق من الجلسة وعضوية الغرفة، والـ identity من الجلسة مش من الطلب.
- ملاحظة: الملفات القديمة (قبل 002) بقت بدون `room_id` فمش ظاهرة لأي حد. العمود القديم اتسمّى `legacy_room`.

**2. Kanban**: 4 أعمدة بسحب وإفلات لحظي، تاسك فيه عنوان/وصف/مسؤول/أولوية/تاريخ/ملف مرتبط، فلتر "تاسكاتي"، والتاسك الـ Doing بيظهر جنب اسم الشخص في قائمة المتصلين. المسؤول لازم يكون عضو في الغرفة (trigger).

**3. شات ورومات صوتية**: شات للغرفة + رسائل خاصة (RLS بتخلي الخاصة لطرفيها بس)، عداد غير مقروء. رومات صوتية دائمة (LiveKit audio-only، التوكن بيمنع الكاميرا/الشاشة)، وأسماء الموجودين بتظهر تحت كل روم. الـ owner يضيف/يحذف رومات. ميتنج الفيديو زي ما هو. جلسة صوت أو ميتنج واحدة في المرة.

**4. استكشاف الكود (للـ owner)**: ربط GitHub بـ OAuth (التوكن متشفّر AES-256-GCM في جدول مقفول على المتصفح)، اختيار المستودع، شجرة فولدرات بالأحجام، أكبر 15 ملف مع آخر committer، وجدول "مين آخر واحد عدّل" لملفات الغرفة. زر "ادفع التعديلات": بيعرض الفروق، بيطلب تأكيد صريح، وبيدفع **دايمًا على فرع جديد** مع PR اختياري. السيرفر بيعيد قراءة المحتوى بنفسه ومش بيصدّق الـ client.

**5. تحسينات**: إشعارات (سؤال/دعوة ميتنج) متخزنة وتوصل للأوفلاين لما يدخل (وتقدر تسأل عضو غير متصل)، بحث في أسماء ومحتوى الملفات، تاريخ نسخ (تلقائي كل ~5 دقايق + يدوي + استرجاع فوري للكل)، حالة (متصل / بعيد / في ميتنج / في روم صوتي) و"بيكتب الآن" في الملف والشات.

## الاختبارات
```bash
npm run typecheck
npm test            # Vitest: provider (Yjs) + مكتبات
npm run test:sql    # يشغّل Postgres محلي مؤقت (محتاج postgresql مثبّت) ويجرّب كل الـ migrations + سياسات RLS
```
`test:sql` بيستخدم `supabase/tests/shim.sql` اللي بيحاكي `auth` و`realtime` (للاختبار المحلي بس، ما يتشغّلش على مشروع Supabase حقيقي).

## اللي اتجرّب فعليًا وما اتجرّبش

**اتجرّب:** `typecheck` و`next build` بعد كل مرحلة؛ 24 اختبار Vitest؛ 94 فحص SQL على Postgres 16 حقيقي (الـ migrations كلها + RLS: أعضاء/غير أعضاء/anon، الدعوات والطرد، الرسائل الخاصة، الـ tokens، `realtime.messages`، النسخ، البحث)؛ الـ proxy بيحوّل غير المسجّل لـ `/login` والـ token route بيرجّع 401.

**ما اتجرّبش (مفيش مفاتيح/حسابات حقيقية هنا):**
- التشغيل على مشروع Supabase حقيقي: إرسال Magic Link، OAuth، وعمل Realtime private فعليًا (الـ shim بيحاكي `realtime.topic()`، فاتأكد من Realtime Policies بعد التطبيق).
- جلسة LiveKit حقيقية (فيديو/صوت) وإن التوكن بيمنع الكاميرا في الرومات الصوتية.
- كل تكامل GitHub (OAuth، الشجرة، commit/PR) ضد API حقيقي. اتجرّب بس التشفير وحساب git SHA والـ diff.
- السحب والإفلات والـ UI في متصفح فعلي، واختبار أكتر من مستخدم متزامن.
- الطرد: العضو المشال بيفقد الوصول للبيانات فورًا، لكن قناة Realtime مفتوحة عنده ممكن تفضل لحد إعادة الاتصال.

## ملاحظات
- `monaco-editor` مثبت على 0.52.2 عشان `y-monaco`.
- الـ scope المطلوب من GitHub هو `repo` (لازم للمستودعات الخاصة والدفع).
- حذف ملف بيحذف تاريخ نسخه.
- السحب والإفلات في الـ Kanban بيشتغل بالماوس (HTML5 DnD)، مش على اللمس.
