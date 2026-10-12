import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { logout } from "../login/actions";
import NavTabs from "./nav-tabs";
import TrainingBanner from "@/components/training-banner";

export default async function AppLayout({ children }) {
  const user = await requireUser();
  const initials = user.FullName.replace(/^(นาย|นางสาว|นาง|นพ\.|พญ\.|ดร\.)\s*/, "").slice(0, 2);

  return (
    <>
      <TrainingBanner />
      <header className="appbar">
        <div className="appbar-in">
          <Link href="/" className="logo" style={{ color: "inherit", textDecoration: "none" }}>
            <span className="logo-mark">MRA</span>
            <span>MRA IPD<small>รพ.สระบุรี</small></span>
          </Link>
          <NavTabs />
          <span className="spacer" />
          <div className="user">
            <span className="avatar">{initials}</span>
            <span>
              <b>{user.FullName}</b> <span className="num muted">{user.Username}</span>
            </span>
            <span className="role">{user.RoleCode}</span>
          </div>
          <form action={logout}>
            <button type="submit" className="ghost">ออกจากระบบ</button>
          </form>
        </div>
      </header>
      <main>{children}</main>
    </>
  );
}
