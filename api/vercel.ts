/**
 * Vercel Serverless Function Wrapper
 * This wraps the Express app for Vercel's serverless environment
 */
import { createServer, IncomingMessage, ServerResponse } from 'http';
import { parse } from 'url';
import { NextRequest, NextResponse } from 'next/server';

// Lazy load the Express app to avoid timeout during cold start
let app: any = null;

async function getExpressApp() {
    if (!app) {
        try {
            // Dynamic import to avoid loading all modules until needed
            const module = await import('./index.js');
            app = module.default;
        } catch (err) {
            console.error('Failed to load Express app:', err);
            throw err;
        }
    }
    return app;
}

// Cache the HTTP server
let server: ReturnType<typeof createServer> | null = null;

function getServer(expressApp: any) {
    if (!server) {
        server = createServer((req: IncomingMessage, res: ServerResponse) => {
            expressApp(req, res);
        });
    }
    return server;
}

async function handleRequest(request: Request): Promise<Response> {
    const { pathname } = parse(request.url || '');

    // Only handle /api/* routes
    if (!pathname?.startsWith('/api/')) {
        return new NextResponse('Not Found', { status: 404 });
    }

    try {
        const expressApp = await getExpressApp();
        const httpServer = getServer(expressApp);

        return new Promise((resolve, reject) => {
            const { pathname: path } = parse(request.url || '', true);

            // Create Express-compatible request object
            const req = {
                method: request.method,
                url: path,
                headers: Object.fromEntries(request.headers.entries()),
            } as any;

            // Create Express-compatible response object
            const res = {
                statusCode: 200,
                headers: {} as Record<string, string>,
                body: '',
                setHeader: function(name: string, value: string) {
                    this.headers[name.toLowerCase()] = value;
                },
                getHeader: function(name: string) {
                    return this.headers[name.toLowerCase()];
                },
                write: function(chunk: any) {
                    this.body += chunk?.toString() || '';
                },
                end: function(chunk?: any) {
                    if (chunk) this.body += chunk?.toString() || '';
                    const response = new NextResponse(this.body, {
                        status: this.statusCode,
                        headers: this.headers,
                    });
                    resolve(response);
                },
                on: function() {},
                removeListener: function() {},
            } as any;

            // Read and process request body
            request.arrayBuffer()
                .then(buffer => {
                    req.body = Buffer.from(buffer);
                    req.rawBody = req.body;

                    // Emit request to Express app
                    httpServer.emit('request', req, res);
                })
                .catch(err => {
                    console.error('Error reading request body:', err);
                    reject(err);
                });
        });
    } catch (err) {
        console.error('Server error:', err);
        return new NextResponse(JSON.stringify({ error: 'Internal Server Error' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
}

// Export HTTP methods
export async function GET(request: Request) {
    return handleRequest(request);
}

export async function POST(request: Request) {
    return handleRequest(request);
}

export async function PUT(request: Request) {
    return handleRequest(request);
}

export async function DELETE(request: Request) {
    return handleRequest(request);
}

export async function PATCH(request: Request) {
    return handleRequest(request);
}
