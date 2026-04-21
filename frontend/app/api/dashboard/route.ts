import { proxyToControl } from "@/lib/control";

export async function GET() {
  return proxyToControl("/dashboard");
}
