import { json } from '@sveltejs/kit';
import { FELLES_OKTER_SHEET_URL } from '$env/static/private';

if (!FELLES_OKTER_SHEET_URL) {
    throw new Error('FELLES_OKTER_SHEET_URL environment variable is not set');
}

export async function GET() {
    return json({ 
        url: FELLES_OKTER_SHEET_URL 
    });
}
