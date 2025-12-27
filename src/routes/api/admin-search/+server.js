import { json } from '@sveltejs/kit';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { JWT_SECRET, USER_CREDENTIALS } from '$env/static/private';

function sha256(str) {
    return crypto.createHash('sha256').update(str).digest('hex');
}

const USER_CREDS = JSON.parse(USER_CREDENTIALS || '{}');

if (!JWT_SECRET) {
    throw new Error('JWT_SECRET environment variable is not set');
}

export async function POST({ request, cookies }) {
    // Sjekk at brukeren er admin først
    const token = cookies.get('auth_token');
    
    if (!token) {
        return json({ 
            success: false, 
            error: "Ikke innlogget." 
        }, { status: 401 });
    }
    
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        
        if (!decoded.isAdmin) {
            return json({ 
                success: false, 
                error: "Ingen tilgang." 
            }, { status: 403 });
        }
        
        const { searchName } = await request.json();
        const nameHash = sha256(searchName.toLowerCase());
        const user = USER_CREDS[nameHash];
        
        if (!user) {
            return json({ 
                success: false, 
                error: "Finner ingen utøver med det navnet." 
            }, { status: 404 });
        }
        
        // Lagre sist søkte utøver i cookie
        cookies.set('last_search_name', searchName, {
            path: '/',
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: 60 * 60 * 24 * 365 // 1 år
        });
        
        return json({ 
            success: true, 
            sheetUrl: user.sheetUrl,
            editPlanSheet: user.editPlanSheet,
            searchName
        });
        
    } catch (error) {
        console.error('Admin search error:', error);
        return json({ 
            success: false, 
            error: "Ugyldig sesjon." 
        }, { status: 401 });
    }
}
