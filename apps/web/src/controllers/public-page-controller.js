const publicNav = [
    { key: 'home', label: 'Home', href: '/', available: true },
    { key: 'slips', label: 'Today\'s Slips', href: '/slips', available: true },
    { key: 'performance', label: 'Performance', href: '/performance', available: true },
    { key: 'history', label: 'History', href: '/history', available: true },
    { key: 'pricing', label: 'Pricing', available: false }
];

export function renderHomePage(req, res, next) {
    try {
        res.render('public/home', {
            layout: 'public',
            pageTitle: 'Football Betting Slips & Performance',
            metaDescription: 'PELOSI publishes football betting slips with transparent historical performance and results.',
            pageScripts: ['/js/public/site.js', '/js/public/ui.js', '/js/public/home.js'],
            nav: buildNav('home')
        });
    } catch (error) {
        next(error);
    }
}

export function redirectTipsToSlips(req, res) {
    res.redirect(302, '/slips');
}

export function renderSlipsPage(req, res, next) {
    try {
        res.render('public/slips', {
            layout: 'public',
            pageTitle: 'Today\'s Slips',
            pageScripts: ['/js/public/site.js', '/js/public/ui.js', '/js/public/slips.js'],
            slipId: req.params.id ?? '',
            nav: buildNav('slips')
        });
    } catch (error) {
        next(error);
    }
}

export function renderPerformancePage(req, res, next) {
    try {
        res.render('public/performance', {
            layout: 'public',
            pageTitle: 'Performance',
            pageScripts: ['/js/public/site.js', '/js/public/ui.js', '/js/public/performance.js'],
            nav: buildNav('performance')
        });
    } catch (error) {
        next(error);
    }
}

export function renderHistoryPage(req, res, next) {
    try {
        res.render('public/history', {
            layout: 'public',
            pageTitle: 'History',
            pageScripts: ['/js/public/site.js', '/js/public/ui.js', '/js/public/history.js'],
            nav: buildNav('history')
        });
    } catch (error) {
        next(error);
    }
}

function buildNav(activeKey) {
    return publicNav.map((item) => ({
        ...item,
        active: item.key === activeKey
    }));
}
