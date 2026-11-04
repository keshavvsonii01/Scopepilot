# Crawler security boundary

ScopePilot treats every submitted URL as untrusted. The API validates a URL before creating a job; the worker repeats validation before navigation and for every browser request, including redirect targets.

## Application controls

- Only `http` and `https` on their default ports (80/443) are accepted.
- URLs with credentials, localhost names, private/reserved IPv4, loopback, IPv6 loopback, unique-local, link-local, multicast, documentation, and cloud-metadata address ranges are rejected.
- DNS is resolved on every validation; an address set containing any blocked address rejects the target.
- Crawling is origin-bound to the submitted scheme/host/port. Discovered cross-origin links and browser subrequests are aborted.
- Browser JavaScript, service workers, downloads, media, manifests, and external-origin requests are disabled/aborted. ScopePilot evaluates only its own fixed scripts: the extraction function and the bundled axe-core engine (injected from the worker's `axe-core` dependency, never fetched). While axe runs, page timer APIs are temporarily replaced with bounded microtask scheduling and restored afterwards; page scripts stay disabled.
- PageSpeed Insights is called by the worker for the already-validated root URL only. Google's infrastructure fetches the page; the worker never forwards PageSpeed responses to the browser, and the API key stays in the worker environment.
- Standard audits are limited to the homepage and three deduplicated same-origin pages.
- API request JSON is limited to 16 KB. A response declaring a `Content-Length` above 5 MB closes the inspected page; screenshots are limited to 1 MB each, axe-core to 15 seconds per page, pages to 15 seconds, PageSpeed Insights requests to 60 seconds (run in parallel with the crawl), and full crawl jobs to 90 seconds (with a 120-second worker lease reaper).

## Required infrastructure controls

DNS validation cannot, on its own, guarantee protection against DNS rebinding or a browser resolver resolving a hostname differently after validation. The worker must run in an isolated network with deny rules for loopback, RFC1918/private, link-local, cloud metadata, internal DNS zones, and non-HTTP(S) egress. It must not share a network namespace with databases, internal APIs, or metadata services. Object storage for screenshots must use private credentials available only to the worker.

The current MongoDB persistence stores bounded screenshot payloads. Move screenshots to private object storage before production-scale usage.
