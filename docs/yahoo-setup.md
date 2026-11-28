# Turning on one-click Yahoo import

Yahoo only lets sites read fantasy leagues after the user logs in on Yahoo, so the site needs its own (free) Yahoo
app. Until this is done, the Yahoo tab tells people to use **Paste** instead.

1. Go to https://developer.yahoo.com/apps/create/ and log in with any Yahoo account.
2. Fill in:
   - **Application Name:** The Sports Mattress
   - **Application Type:** Web Application (Confidential Client)
   - **Redirect URI(s):** `https://sportsmattress.io/yahoo/` (exactly this, with the trailing slash)
   - **API Permissions:** check **Fantasy Sports** → **Read**
3. Click **Create App**. Yahoo shows a **Client ID (Consumer Key)** and a **Client Secret (Consumer Secret)**.
4. In Supabase: project `the-sports-mattress` → **Edge Functions** → **Secrets** (or Project Settings → Edge Functions),
   add two secrets:
   - `YAHOO_CLIENT_ID` = the Client ID
   - `YAHOO_CLIENT_SECRET` = the Client Secret
5. That's it. The `yahoo` function picks them up right away and the Yahoo tab switches to **Connect Yahoo**.

Never paste the Client Secret into chat, code or GitHub. It only belongs in Supabase's secrets.

The function's source is `supabase/functions/yahoo/index.ts`. It exchanges Yahoo's one-time login code for a
short-lived token, reads the user's NFL teams, rosters and league settings once, and stores nothing.
