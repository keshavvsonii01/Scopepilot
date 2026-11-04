import { forwardToApi } from "@/lib/api-proxy";

type Context = { params: Promise<{ path: string[] }> };

export async function GET(request: Request, { params }: Context) {
  return forwardToApi(request, (await params).path);
}

export async function POST(request: Request, { params }: Context) {
  return forwardToApi(request, (await params).path);
}

export async function PUT(request: Request, { params }: Context) {
  return forwardToApi(request, (await params).path);
}
