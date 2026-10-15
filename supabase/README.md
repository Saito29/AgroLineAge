# Supabase setup and access control

Apply migrations in order with the Supabase CLI (`supabase db push`) or the SQL editor:

1. `migrations/202610150001_shared_livestock.sql`
2. `migrations/202610150002_private_access_and_approvals.sql`
3. `migrations/202610150003_archiving_and_lineage_guards.sql`
4. `migrations/202610150004_realtime_shared_records.sql`

The frontend is connected through `src/js/config.js` using the Project URL and publishable key. The key is intended for browser use; never place a secret/service-role key in the repository. In Authentication > URL Configuration, set the Site URL to the deployed app (for example, `https://saito29.github.io/AgroLineAge/`) and add that URL to Redirect URLs. Add any local development URL too. Enable email/password sign-in and configure the password recovery redirect to the same app URL. Email confirmation is recommended. A signup creates a profile with `approval_status = 'pending'` and `app_role = 'user'`; users cannot write either field through the Data API. A login session alone grants no application data access. RLS and the transfer RPC check the current profile row on every request, so suspending a signed-in user takes effect without waiting for a JWT refresh.

## Initial administrator

Create the intended account through Supabase Auth, verify its identity, and confirm its email. In Authentication > Users, copy that account's immutable Auth UUID. Review the UUID in `bootstrap_initial_admin.sql` and make sure it matches the intended account, then run the script from the Supabase SQL editor as the trusted project database owner. It refuses an unknown/unconfirmed user and refuses to claim a second initial administrator. Signup, profile metadata, URL values, and browser storage cannot bootstrap an administrator. Do not expose a service-role key or run this SQL through the public app.

There is no in-app role promotion feature. For recovery, a project owner should verify the intended operator's Auth UUID, use the trusted SQL editor to inspect `profiles`, and make an explicit audited role/status correction as database owner. Never grant roles by email-only matching. Keep the recovery action and operator identity in the project's administrative records.

## Approval workflow

Statuses are `pending`, `approved`, `rejected`, and `suspended`. Allowed transitions are pending to approved/rejected, rejected to approved, approved to suspended, and suspended to approved. `admin_set_user_status` is executable only by authenticated administrators; it records the acting administrator, timestamp, and optional reason in `audit_events`. Approval never changes the user's role. The first administrator is set up only with the trusted bootstrap script.

All authenticated approved users share the same livestock tables. Pending, rejected, and suspended accounts may read their own profile status, but cannot access shared records or private Storage objects. User administration requires the administrator role. The `animal-attachments` bucket is private; project-level Storage limits may need adjustment if uploads larger than the Supabase default are required.

Approved users load and save the shared organization, owner, animal, and activity records through the Data API. Animal ownership changes use the guarded transfer RPC. Attachments use the private `animal-attachments` bucket. When a project has no records, the app offers to import the current browser's locally saved records. Existing Supabase data takes precedence and is loaded into the app.

Apply all four migrations, including the Realtime publication migration, then deploy the updated files. Live shared-record refreshes require authenticated approved users and working Realtime subscriptions. The app cannot verify the Supabase connection until the migrations have been run and the Auth redirect URLs are configured in the project dashboard.
