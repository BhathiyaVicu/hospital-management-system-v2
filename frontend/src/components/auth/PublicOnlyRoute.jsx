import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { getCurrentUser, getAccessToken } from '../../services/api';

export default function PublicOnlyRoute({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(() => Boolean(getAccessToken()));
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    const token = getAccessToken();
    
    if (!token) {
      return;
    }

    getCurrentUser()
      .then((res) => {
        if (active) setUser(res.user);
      })
      .catch((err) => {
        if (active) {
          setUser(null);
          if (err.status !== 401) setError(err.message || 'Failed to verify your session.');
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => { active = false; };
  }, []);

  if (user) {
    const role = user.role;
    const path = role === 'admin' ? '/admin/dashboard' 
               : role === 'doctor' ? '/doctor/dashboard' 
               : role === 'patient' ? '/dashboard' 
               : role === 'staff' ? '/staff/support' 
               : role === 'receptionist' ? '/receptionist/dashboard' 
               : '/';
               
    return <Navigate to={path} replace />;
  }

  // If no token and no user, show the login page
  return children;
}