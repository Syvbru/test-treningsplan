import { json } from '@sveltejs/kit';
import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '$env/static/private';

if (!JWT_SECRET) {
    throw new Error('JWT_SECRET environment variable is not set');
}

export async function GET({ cookies }) {
    const token = cookies.get('auth_token');
    
    if (!token) {
        return json({ 
            authenticated: false 
        });
    }
    
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        
        const response = {
            authenticated: true,
            isAdmin: decoded.isAdmin,
            sheetUrl: decoded.sheetUrl,
            editPlanSheet: decoded.editPlanSheet,  
            username: decoded.username,
            userKeyHash: decoded.userKeyHash
        };
        
        // Hvis admin, sjekk om det finnes en sist søkt utøver
        if (decoded.isAdmin) {
            const lastSearchName = cookies.get('last_search_name');
            if (lastSearchName) {
                response.lastSearchName = lastSearchName;
            }
        }
        
        return json(response);
    } catch (error) {
        // Token er ugyldig eller utløpt
        cookies.delete('auth_token', { path: '/' });
        return json({ 
            authenticated: false 
        });
    }
}
