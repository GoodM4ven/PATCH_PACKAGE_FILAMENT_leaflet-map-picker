// Backoff helpers -------------------------------------------------------------
export function backoffDelays(max = 5) {
    // 0.5s, 1s, 2s, 4s, 8s
    return Array.from({ length: max }, (_, i) => 500 * Math.pow(2, i));
}
export async function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

// Small utils -----------------------------------------------------------------
export function throttle(fn, wait) {
    let last = 0,
        t = null,
        lastArgs = null;
    return (...args) => {
        const now = Date.now();
        const remaining = wait - (now - last);
        lastArgs = args;
        if (remaining <= 0) {
            clearTimeout(t);
            t = null;
            last = now;
            fn(...args);
        } else if (!t) {
            t = setTimeout(() => {
                last = Date.now();
                t = null;
                fn(...lastArgs);
            }, remaining);
        }
    };
}
export function debounce(fn, wait) {
    let t = null;
    return (...args) => {
        clearTimeout(t);
        t = setTimeout(() => fn(...args), wait);
    };
}

export function isTransientNetworkError(err) {
    const msg = (err && (err.message || err.toString())) || '';
    // Chrome error string or fetch TypeError
    return msg.includes('ERR_NETWORK_CHANGED') || msg.includes('Failed to fetch') || msg.includes('NetworkError');
}

// Token bucket with metadata --------------------------------------------------
export function createRateLimiter(limit, interval = 60000) {
    let tokens = limit;
    let windowStart = Date.now();
    return {
        try() {
            const now = Date.now();
            if (now - windowStart >= interval) {
                tokens = limit;
                windowStart = now;
            }
            const ok = tokens > 0;
            if (ok) tokens -= 1;
            const resetMs = Math.max(0, interval - (now - windowStart));
            return { ok, remaining: tokens, resetMs };
        },
        peekResetMs() {
            const now = Date.now();
            return Math.max(0, interval - (now - windowStart));
        },
    };
}

// UI bits: overlay + banner ---------------------------------------------------
export function ensureOverlay(container) {
    let shield = container.querySelector('[data-mt-lock-shield]');
    if (!shield) {
        shield = document.createElement('div');
        shield.setAttribute('data-mt-lock-shield', '1');
        Object.assign(shield.style, {
            position: 'absolute',
            inset: '0',
            // keep it transparent; we only block pointer events
            background: 'transparent',
            zIndex: 9998,
            display: 'none',
        });
        container.appendChild(shield);
    }
    return {
        show() {
            shield.style.display = 'block';
        },
        hide() {
            shield.style.display = 'none';
        },
    };
}

export function ensureCountdownBanner(container) {
    // Ensure container is positioning context
    const cs = getComputedStyle(container);
    if (cs.position === 'static') container.style.position = 'relative';

    let el = container.querySelector('[data-mt-throttle-banner]');
    let counter = null;
    if (!el) {
        el = document.createElement('div');
        el.setAttribute('data-mt-throttle-banner', '1');
        // style (same vibe as before, but positioned in container)
        Object.assign(el.style, {
            position: 'absolute',
            top: '8px',
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'rgba(220,53,69,.95)',
            color: '#fff',
            padding: '6px 10px',
            borderRadius: '6px',
            zIndex: 9999,
            font: '600 12px system-ui',
            boxShadow: '0 4px 12px rgba(0,0,0,.25)',
            display: 'none',
            alignItems: 'center',
            gap: '6px',
        });

        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('width', '16');
        svg.setAttribute('height', '16');
        svg.setAttribute('fill', 'none');
        svg.setAttribute('stroke', 'currentColor');
        svg.setAttribute('stroke-width', '2');
        svg.setAttribute('stroke-linecap', 'round');
        svg.setAttribute('stroke-linejoin', 'round');
        svg.innerHTML = '<circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l3 3"></path>';

        counter = document.createElement('span');
        counter.textContent = '0s';

        el.appendChild(svg);
        el.appendChild(counter);
        container.appendChild(el);
    } else {
        counter =
            el.querySelector('span') ||
            (() => {
                const s = document.createElement('span');
                el.appendChild(s);
                return s;
            })();
    }
    return {
        update(ms) {
            const s = Math.max(0, Math.ceil(ms / 1000));
            counter.textContent = `${s}s`;
            el.style.display = s > 0 ? 'inline-flex' : 'none';
        },
        hide() {
            el.style.display = 'none';
        },
    };
}
