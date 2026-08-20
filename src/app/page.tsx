import { AttendanceDashboard } from "@/components/attendance-dashboard";
import { AuthProvider } from "@/components/auth/auth-provider";

export default function Home() {
  return (
    <AuthProvider>
      <AttendanceDashboard />
    </AuthProvider>
  );
}
