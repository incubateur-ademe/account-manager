import { signOut } from "@/lib/auth";

export function Deconnexion({ username }: { username: string }) {
  return (
    <form
      action={async () => {
        "use server";
        await signOut({ redirectTo: "/login" });
      }}
    >
      <button
        type="submit"
        className="fr-btn fr-btn--tertiary-no-outline fr-icon-logout-box-r-line"
      >
        Se déconnecter ({username})
      </button>
    </form>
  );
}
