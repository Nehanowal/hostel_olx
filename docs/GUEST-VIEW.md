# Guest browsing

Share `https://hostel-olx.vercel.app/?guest=1` for direct guest access, or select **Explore as a guest** on the sign-in page.

Guests can search, filter and preview photos of active, non-demo listings from active sellers in the configured university. The public API explicitly returns only listing ID, title, category, condition, price, creation date and guest photo URLs. Seller identities, emails, descriptions, custom attributes and exact meetup-location fields are excluded. Photos are shown as uploaded; text or identifying details embedded in a photo or title remain visible.

Public photo requests recheck listing and seller eligibility before issuing the existing short-lived Cloudinary link. Sold, unavailable, deleted, removed, other-university and unlinked upload images are inaccessible through the guest endpoint. Previously issued one-minute image links can remain usable until expiry.

Private listing APIs, messages, uploads, saves and admin routes still require authentication. Guest views do not increment student popularity or active-user counts. The same API rate limit applies to public requests.
