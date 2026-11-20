import { NextResponse } from 'next/server';

export const revalidate = 86400;

type ProviderResponse = {
  result?: string;
  base_code?: string;
  conversion_rates?: { INR?: number };
  time_last_update_utc?: string;
};

export async function GET() {
  const apiKey = process.env.EXCHANGE_RATE_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'Exchange rate API key is not configured on the server' }, { status: 503 });
  }

  try {
    const response = await fetch('https://v6.exchangerate-api.com/v6/latest/USD', {
      headers: { Authorization: `Bearer ${apiKey}` },
      next: { revalidate: 86400 },
    });
    if (!response.ok) {
      return NextResponse.json({ error: `Rate provider returned ${response.status}` }, { status: 502 });
    }

    const data = await response.json() as ProviderResponse;
    if (data.result !== 'success' || data.base_code !== 'USD' || !Number.isFinite(data.conversion_rates?.INR) || !data.time_last_update_utc) {
      return NextResponse.json({ error: 'Rate provider returned an invalid USD to INR rate' }, { status: 502 });
    }

    return NextResponse.json({
      result: data.result,
      base_code: data.base_code,
      rates: { INR: data.conversion_rates?.INR },
      time_last_update_utc: data.time_last_update_utc,
    }, { headers: { 'Cache-Control': 'public, max-age=3600' } });
  } catch {
    return NextResponse.json({ error: 'Could not connect to the exchange rate provider' }, { status: 502 });
  }
}
