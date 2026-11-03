# 3S and BizCity Posting Board

Day-by-day posting board for 3S Business and BizCity Group: every planned post, its status and its live link.

- `index.html` is the board (single page, no build step).
- `backend.js` connects it to the Supabase project `posting-board` (table `public.posts`, one JSON document per post).
- Anyone with the link can view. Only accounts listed in `public.editors` can add, edit or delete posts; this is enforced by row-level security in Supabase.
- The key in `backend.js` is the publishable key, which is meant to be public.

Hosted on GitHub Pages from `main`. The page is set to noindex.
