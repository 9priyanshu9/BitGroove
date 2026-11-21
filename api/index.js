'use strict';

const app = require('../server');

module.exports = (req, res) => {
    const url = new URL(req.url, 'http://bitgroove.internal');
    const apiPath = url.searchParams.get('__bitgroove_path') ?? req.query?.__bitgroove_path;
    if (typeof apiPath === 'string') {
        // Vercel can replace req.url with the rewrite destination. Carry the route
        // explicitly, then restore it before Express matches its nested endpoints.
        url.pathname = `/api/${apiPath.replace(/^\/+/, '')}`;
        url.searchParams.delete('__bitgroove_path');
        req.url = url.pathname + url.search;
        if (req.query) delete req.query.__bitgroove_path;
    }
    return app(req, res);
};
