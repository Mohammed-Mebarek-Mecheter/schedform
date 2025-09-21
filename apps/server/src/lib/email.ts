// lib/email.ts
import {
    TransactionalEmailsApi,
    SendSmtpEmail,
    TransactionalEmailsApiApiKeys
} from "@getbrevo/brevo";
import { env } from "./env";

// Initialize the Brevo API client
const emailAPI = new TransactionalEmailsApi();
emailAPI.setApiKey(TransactionalEmailsApiApiKeys.apiKey, env.BREVO_API_KEY);

export async function sendOrganizationInvitation({
                                                     email,
                                                     invitedByUsername,
                                                     invitedByEmail,
                                                     organizationName,
                                                     inviteLink,
                                                 }: {
    email: string;
    invitedByUsername: string;
    invitedByEmail: string;
    organizationName: string;
    inviteLink: string;
}) {
    try {
        const message = new SendSmtpEmail();
        message.subject = `You've been invited to join ${organizationName} on SchedForm`;
        message.sender = {
            name: "SchedForm Team",
            email: "noreply@schedform.com" // Replace with your actual sender email
        };
        message.to = [{ email, name: email }]; // Using email as name since we don't have recipient's name

        // HTML content
        message.htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Organization Invitation</title>
      </head>
      <body>
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Join ${organizationName} on SchedForm</h2>
          <p>You've been invited by ${invitedByUsername} (${invitedByEmail}) to join their organization on SchedForm.</p>
          <p>SchedForm helps teams schedule qualified meetings with prospects and clients.</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${inviteLink}" 
               style="background-color: #4F46E5; color: white; padding: 12px 24px; 
                      text-decoration: none; border-radius: 4px; display: inline-block;">
              Accept Invitation
            </a>
          </div>
          <p>Or copy and paste this link in your browser:<br>
          <code style="word-break: break-all;">${inviteLink}</code></p>
          <hr>
          <p style="color: #666; font-size: 14px;">
            If you didn't expect this invitation, you can safely ignore this email.
          </p>
        </div>
      </body>
      </html>
    `;

        // Plain text content for email clients that don't support HTML
        message.textContent = `
      Join ${organizationName} on SchedForm

      You've been invited by ${invitedByUsername} (${invitedByEmail}) to join their organization on SchedForm.

      SchedForm helps teams schedule qualified meetings with prospects and clients.

      Accept your invitation here: ${inviteLink}

      If you didn't expect this invitation, you can safely ignore this email.
    `;

        const result = await emailAPI.sendTransacEmail(message);
        console.log('Invitation email sent! Message ID:', result.body.messageId);
        return result;
    } catch (error) {
        console.error('Failed to send invitation email:', error);
        throw error;
    }
}
