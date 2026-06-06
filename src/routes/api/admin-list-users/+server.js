import { json } from '@sveltejs/kit';
import jwt from 'jsonwebtoken';
import { JWT_SECRET, USER_NAMES } from '$env/static/private';

export async function GET({ cookies }) {
    const token = cookies.get('auth_token');

    if (!token) {
        return json({ success: false, error: "Ikke innlogget." }, { status: 401 });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);

        if (!decoded.isAdmin) {
            return json({ success: false, error: "Ingen tilgang." }, { status: 403 });
        }

        const names = (USER_NAMES || '')
            .split(',')
            .map(n => n.trim())
            .filter(Boolean)
            .sort((a, b) => a.localeCompare(b, 'nb'));

        return json({ success: true, names });

    } catch {
        return json({ success: false, error: "Ugyldig sesjon." }, { status: 401 });
    }
}
