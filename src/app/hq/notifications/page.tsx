import {
  StaffNotificationsInbox,
  staffNotificationsMetadata,
} from "@/components/notifications/StaffNotificationsInbox";

export const metadata = staffNotificationsMetadata();

export default function Page() {
  return (
    <StaffNotificationsInbox
      portal="hq"
      description="Alerts when employers submit job orders and other HQ-wide activity."
    />
  );
}
