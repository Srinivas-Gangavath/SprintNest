export function invitationEmail(
  orgName: string,
  inviterName: string,
  acceptUrl: string,
): { subject: string; html: string } {
  return {
    subject: `SprintNest — You've been invited to join ${orgName}`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
        <h2 style="color: #1e293b;">You're Invited!</h2>
        <p style="color: #475569;">${inviterName} has invited you to join <strong>${orgName}</strong> on SprintNest.</p>
        <a href="${acceptUrl}"
           style="display: inline-block; padding: 12px 24px; background: #3b82f6; color: #fff; text-decoration: none; border-radius: 6px; margin: 16px 0;">
          Accept Invitation
        </a>
        <p style="color: #94a3b8; font-size: 13px;">This invitation expires in 7 days.</p>
      </div>
    `.trim(),
  };
}
