import { ReactNode } from "react";
// import { Navigate } from "react-router-dom";
// import { useAuth } from "../context/AuthContext";

// AUTHENTICATION IS ON HOLD.
// The app is currently open — anyone can use the tools without signing in.
// To re-enable the login gate later, restore the commented-out logic below.
export default function ProtectedRoute({ children }: { children: ReactNode }) {
  return <>{children}</>;

  // --- Re-enable auth later by removing the line above and using this: ---
  // const { user, loading } = useAuth();
  // if (loading) {
  //   return (
  //     <div className="center-load">
  //       <div className="spinner dark" />
  //     </div>
  //   );
  // }
  // if (!user) return <Navigate to="/login" replace />;
  // return <>{children}</>;
}
