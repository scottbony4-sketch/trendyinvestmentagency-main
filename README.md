
## Supabase setup

1. In Supabase Dashboard, open the project with ID `kxtbxzolhflilkfsntdt`.
2. Open Project Settings > API and copy the project URL and publishable key.
3. Copy `.env.example` to `.env` and replace `your_supabase_publishable_key` with that key.
4. For server-side admin features, also set `SUPABASE_SERVICE_ROLE_KEY` using the secret service-role key from the same API page. Never expose that key in client-side code.

The local `.env` file is ignored by Git. Restart the Vite dev server after changing environment variables.

