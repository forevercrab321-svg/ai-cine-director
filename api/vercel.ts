/**
 * Vercel Serverless Function Wrapper
 * This wraps the Express app for Vercel's serverless environment
 */
import { createServer } from 'http';
import { parse } from 'url';
import { NextRequest, NextResponse } from 'next/server';
import app from './index';

// Cache the server to avoid recreating it on every cold start
let server: ReturnType<typeof createServer> | null = null;

function getServer() {
    if (!server) {
        server = createServer((req, res) => {
            // @ts-ignore - Express typing mismatch with Node http
            app(req, res);
        });
    }
    return server;
}

// For GET requests
export async function GET(request: Request) {
    return handleRequest(request);
}

// For POST requests
export async function POST(request: Request) {
    return handleRequest(request);
}

// For PUT requests
export async function PUT(request: Request) {
    return handleRequest(request);
}

// For DELETE requests
export async function DELETE(request: Request) {
    return handleRequest(request);
}

// For PATCH requests
export async function PATCH(request: Request) {
    return handleRequest(request);
}

async function handleRequest(request: Request): Promise<Response> {
    const { pathname } = parse(request.url);

    // Only handle /api/* routes
    if (!pathname?.startsWith('/api/')) {
        return new NextResponse('Not Found', { status: 404 });
    }

    return new Promise((resolve, reject) => {
        const server = getServer();
        const { pathname: path, query } = parse(request.url, true);

        // @ts-ignore
        const req = {
            method: request.method,
            url: path,
            headers: Object.fromEntries(request.headers.entries()),
            body: null as Buffer | null,
        };

        // Read body
        request.arrayBuffer().then(buffer => {
            (req as any).body = Buffer.from(buffer);

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
                    this.body += chunk.toString();
                },
                end: function(chunk?: any) {
                    if (chunk) this.body += chunk.toString();
                    const response = new NextResponse(this.body, {
                        status: this.statusCode,
                        headers: this.headers,
                    });
                    resolve(response);
                },
                on: function() {},
                removeListener: function() {},
            } as any;

            // @ts-ignore
            server.emit('request', req, res);
        }).catch(reject);
    });
}
