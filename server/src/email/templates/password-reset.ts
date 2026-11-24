export function passwordResetEmail(resetUrl: string): { subject: string; html: string } {
  return {
    subject: 'SprintNest — Reset Your Password',
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
        <h2 style="color: #1e293b;">Reset Your Password</h2>
        <p style="color: #475569;">You requested a password reset for your SprintNest account.</p>
        <p style="color: #475569;">Click the link below to set a new password. This link expires in 1 hour.</p>
        <a href="${resetUrl}"
           style="display: inline-block; padding: 12px 24px; background: #3b82f6; color: #fff; text-decoration: none; border-radius: 6px; margin: 16px 0;">
          Reset Password
        </a>
        <p style="color: #94a3b8; font-size: 13px;">If you didn't request this, you can safely ignore this email.</p>
      </div>
    `.trim(),
  };
}
