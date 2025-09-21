// lib/email.ts
import {
    TransactionalEmailsApi,
    SendSmtpEmail,
    TransactionalEmailsApiApiKeys
} from "@getbrevo/brevo";
import { env } from "./env";

// Initialize the Brevo API client using the modern approach
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

export async function sendEmailOTP({
                                       email,
                                       otp,
                                       type,
                                       userName,
                                   }: {
    email: string;
    otp: string;
    type: "sign-in" | "email-verification" | "forget-password" | "two-factor";
    userName: string;
}) {
    try {
        const message = new SendSmtpEmail();
        message.sender = {
            name: "SchedForm Security",
            email: "security@schedform.com" // Replace with your actual sender email
        };
        message.to = [{ email, name: userName }];

        // Customize content based on OTP type
        let subject: string;
        let heading: string;
        let description: string;
        let expiryText: string = "This code will expire in 5 minutes.";

        switch (type) {
            case "sign-in":
                subject = "Your SchedForm Sign-in Code";
                heading = "Sign in to SchedForm";
                description = "Use this code to sign in to your SchedForm account:";
                break;
            case "email-verification":
                subject = "Verify Your SchedForm Email Address";
                heading = "Verify Your Email";
                description = "Please verify your email address with this code:";
                break;
            case "forget-password":
                subject = "Reset Your SchedForm Password";
                heading = "Reset Your Password";
                description = "Use this code to reset your SchedForm password:";
                expiryText = "This code will expire in 10 minutes.";
                break;
            case "two-factor":
                subject = "Your SchedForm Two-Factor Authentication Code";
                heading = "Two-Factor Authentication";
                description = "Your two-factor authentication code is:";
                break;
            default:
                subject = "Your SchedForm Verification Code";
                heading = "Verification Code";
                description = "Your verification code is:";
        }

        message.subject = subject;

        // HTML content
        message.htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>${subject}</title>
      </head>
      <body>
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #4F46E5; margin: 0;">SchedForm</h1>
          </div>
          
          <h2>${heading}</h2>
          <p>Hi ${userName},</p>
          <p>${description}</p>
          
          <div style="text-align: center; margin: 30px 0;">
            <div style="background-color: #f8fafc; border: 2px dashed #e2e8f0; 
                        border-radius: 8px; padding: 20px; display: inline-block;">
              <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; 
                           color: #1e293b; font-family: 'Courier New', monospace;">
                ${otp}
              </span>
            </div>
          </div>
          
          <p style="color: #64748b; font-size: 14px; text-align: center;">
            ${expiryText}
          </p>
          
          <hr style="margin: 30px 0; border: none; border-top: 1px solid #e2e8f0;">
          
          <p style="color: #64748b; font-size: 12px; margin: 0;">
            If you didn't request this code, you can safely ignore this email. 
            Someone else might have typed your email address by mistake.
          </p>
          
          <p style="color: #64748b; font-size: 12px; margin: 10px 0 0 0;">
            For security reasons, please don't share this code with anyone.
          </p>
        </div>
      </body>
      </html>
    `;

        // Plain text content
        message.textContent = `
${heading}

Hi ${userName},

${description}

Your verification code is: ${otp}

${expiryText}

If you didn't request this code, you can safely ignore this email. Someone else might have typed your email address by mistake.

For security reasons, please don't share this code with anyone.

- The SchedForm Team
    `;

        const result = await emailAPI.sendTransacEmail(message);
        console.log(`${type} OTP email sent! Message ID:`, result.body.messageId);
        return result;
    } catch (error) {
        console.error(`Failed to send ${type} OTP email:`, error);
        throw error;
    }
}

export async function sendBookingConfirmation({
                                                  email,
                                                  userName,
                                                  bookingDetails,
                                              }: {
    email: string;
    userName: string;
    bookingDetails: {
        title: string;
        date: string;
        time: string;
        duration: string;
        meetingLink?: string;
        hostName: string;
        location?: string;
    };
}) {
    try {
        const message = new SendSmtpEmail();
        message.subject = `Booking Confirmed: ${bookingDetails.title}`;
        message.sender = {
            name: "SchedForm Bookings",
            email: "bookings@schedform.com"
        };
        message.to = [{ email, name: userName }];

        message.htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Booking Confirmation</title>
      </head>
      <body>
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #4F46E5; margin: 0;">SchedForm</h1>
          </div>
          
          <h2>Your booking is confirmed!</h2>
          <p>Hi ${userName},</p>
          <p>Your booking has been successfully confirmed. Here are the details:</p>
          
          <div style="background-color: #f8fafc; border-radius: 8px; padding: 20px; margin: 20px 0;">
            <h3 style="margin: 0 0 15px 0; color: #1e293b;">${bookingDetails.title}</h3>
            <p style="margin: 5px 0;"><strong>Date:</strong> ${bookingDetails.date}</p>
            <p style="margin: 5px 0;"><strong>Time:</strong> ${bookingDetails.time}</p>
            <p style="margin: 5px 0;"><strong>Duration:</strong> ${bookingDetails.duration}</p>
            <p style="margin: 5px 0;"><strong>Host:</strong> ${bookingDetails.hostName}</p>
            ${bookingDetails.location ? `<p style="margin: 5px 0;"><strong>Location:</strong> ${bookingDetails.location}</p>` : ''}
            ${bookingDetails.meetingLink ? `
              <div style="margin-top: 15px;">
                <a href="${bookingDetails.meetingLink}" 
                   style="background-color: #4F46E5; color: white; padding: 10px 20px; 
                          text-decoration: none; border-radius: 4px; display: inline-block;">
                  Join Meeting
                </a>
              </div>
            ` : ''}
          </div>
          
          <p>We'll send you a reminder 24 hours before your scheduled meeting.</p>
          
          <hr style="margin: 30px 0; border: none; border-top: 1px solid #e2e8f0;">
          
          <p style="color: #64748b; font-size: 12px;">
            Need to reschedule or cancel? Please contact ${bookingDetails.hostName} directly.
          </p>
        </div>
      </body>
      </html>
    `;

        message.textContent = `
Your booking is confirmed!

Hi ${userName},

Your booking has been successfully confirmed. Here are the details:

${bookingDetails.title}
Date: ${bookingDetails.date}
Time: ${bookingDetails.time}
Duration: ${bookingDetails.duration}
Host: ${bookingDetails.hostName}
${bookingDetails.location ? `Location: ${bookingDetails.location}` : ''}
${bookingDetails.meetingLink ? `Meeting Link: ${bookingDetails.meetingLink}` : ''}

We'll send you a reminder 24 hours before your scheduled meeting.

Need to reschedule or cancel? Please contact ${bookingDetails.hostName} directly.

- The SchedForm Team
    `;

        const result = await emailAPI.sendTransacEmail(message);
        console.log('Booking confirmation email sent! Message ID:', result.body.messageId);
        return result;
    } catch (error) {
        console.error('Failed to send booking confirmation email:', error);
        throw error;
    }
}

export async function sendWelcomeEmail({
                                           email,
                                           userName,
                                           isNewOrganization = false,
                                       }: {
    email: string;
    userName: string;
    isNewOrganization?: boolean;
}) {
    try {
        const message = new SendSmtpEmail();
        message.subject = "Welcome to SchedForm!";
        message.sender = {
            name: "SchedForm Team",
            email: "welcome@schedform.com"
        };
        message.to = [{ email, name: userName }];

        const organizationText = isNewOrganization
            ? "You've successfully created your organization and can now start inviting team members."
            : "You're now part of the SchedForm community.";

        message.htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Welcome to SchedForm</title>
      </head>
      <body>
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #4F46E5; margin: 0;">Welcome to SchedForm!</h1>
          </div>
          
          <p>Hi ${userName},</p>
          <p>Welcome to SchedForm - where every scheduling link becomes a qualified conversation!</p>
          <p>${organizationText}</p>
          
          <div style="background-color: #f8fafc; border-radius: 8px; padding: 20px; margin: 20px 0;">
            <h3 style="margin: 0 0 15px 0; color: #1e293b;">Get Started</h3>
            <ul style="margin: 0; padding-left: 20px;">
              <li style="margin: 8px 0;">Create your first conversational form</li>
              <li style="margin: 8px 0;">Connect your calendar</li>
              <li style="margin: 8px 0;">Share your scheduling link</li>
              <li style="margin: 8px 0;">Turn prospects into qualified meetings</li>
            </ul>
          </div>
          
          <div style="text-align: center; margin: 30px 0;">
            <a href="${env.BETTER_AUTH_URL}/dashboard" 
               style="background-color: #4F46E5; color: white; padding: 12px 24px; 
                      text-decoration: none; border-radius: 4px; display: inline-block;">
              Get Started
            </a>
          </div>
          
          <p>If you have any questions, feel free to reach out to our support team.</p>
          
          <p>Best regards,<br>The SchedForm Team</p>
        </div>
      </body>
      </html>
    `;

        message.textContent = `
Welcome to SchedForm!

Hi ${userName},

Welcome to SchedForm - where every scheduling link becomes a qualified conversation!

${organizationText}

Get Started:
- Create your first conversational form
- Connect your calendar  
- Share your scheduling link
- Turn prospects into qualified meetings

Visit your dashboard: ${env.BETTER_AUTH_URL}/dashboard

If you have any questions, feel free to reach out to our support team.

Best regards,
The SchedForm Team
    `;

        const result = await emailAPI.sendTransacEmail(message);
        console.log('Welcome email sent! Message ID:', result.body.messageId);
        return result;
    } catch (error) {
        console.error('Failed to send welcome email:', error);
        throw error;
    }
}
