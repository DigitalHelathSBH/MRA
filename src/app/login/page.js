import LoginForm from "./login-form";
import TrainingBanner from "@/components/training-banner";

export const metadata = { title: "เข้าสู่ระบบ · MRA IPD" };

export default function LoginPage() {
  return (
    <div className="login-wrap">
      <TrainingBanner />
      <LoginForm />
    </div>
  );
}
