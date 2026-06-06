import { json } from '@sveltejs/kit';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { JWT_SECRET, USER_CREDENTIALS, USER_NAMES } from '$env/static/private';

function sha256(str) {
    return crypto.createHash('sha256').update(str).digest('hex');
}

const USER_CREDS = JSON.parse(USER_CREDENTIALS || '{}');

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
            .filter(Boolean);

        const result = names
            .map(name => {
                const hash = sha256(name.toLowerCase());
                const user = USER_CREDS[hash];
                return user?.editPlanSheet
                    ? { name, editPlanSheet: user.editPlanSheet }
                    : null;
            })
            .filter(Boolean);

        return json({ success: true, users: result });

    } catch {
        return json({ success: false, error: "Ugyldig sesjon." }, { status: 401 });
    }
}
