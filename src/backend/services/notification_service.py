"""Email notification service for async job completion.

Sends HTML email notifications via SMTP when long-running jobs
(e.g., voicebank generation) complete. Uses aiosmtplib for async
delivery so the worker event loop is not blocked.

All send failures are logged but never propagated -- a failed
notification must never cause a successful job to appear failed.
"""

import logging
from email.message import EmailMessage

import aiosmtplib

from src.backend.config import Settings, get_settings

logger = logging.getLogger(__name__)


def _build_html_body(
    voice_name: str,
    preview_url: str,
    voicebank_url: str,
) -> str:
    """Build the HTML email body for a job completion notification.

    Args:
        voice_name: Display name of the generated voicebank
        preview_url: URL to listen to a preview of the voicebank
        voicebank_url: URL to open the voicebank in the application

    Returns:
        HTML string for the email body
    """
    return f"""\
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Your voicebank is ready</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5;padding:32px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;overflow:hidden;">
          <!-- Header -->
          <tr>
            <td style="background-color:#18181b;padding:24px 32px;">
              <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:600;">
                UTAU Voicebank Manager
              </h1>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:32px;">
              <h2 style="margin:0 0 8px;color:#18181b;font-size:22px;font-weight:600;">
                Your voicebank is ready!
              </h2>
              <p style="margin:0 0 24px;color:#52525b;font-size:15px;line-height:1.6;">
                <strong>{voice_name}</strong> has finished generating and is
                ready to use. You can preview the result or open it directly
                in the application.
              </p>
              <!-- CTA buttons -->
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;">
                <tr>
                  <td style="padding-right:12px;">
                    <a href="{preview_url}"
                       style="display:inline-block;padding:12px 24px;background-color:#2563eb;color:#ffffff;text-decoration:none;border-radius:6px;font-size:14px;font-weight:500;">
                      Listen to Preview
                    </a>
                  </td>
                  <td>
                    <a href="{voicebank_url}"
                       style="display:inline-block;padding:12px 24px;background-color:#18181b;color:#ffffff;text-decoration:none;border-radius:6px;font-size:14px;font-weight:500;">
                      Open Your Voice
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:16px 32px;border-top:1px solid #e4e4e7;">
              <p style="margin:0;color:#a1a1aa;font-size:12px;line-height:1.5;">
                You received this email because you subscribed to job
                notifications. If you did not request this, you can safely
                ignore it.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>"""


def _build_plain_body(
    voice_name: str,
    preview_url: str,
    voicebank_url: str,
) -> str:
    """Build the plain-text fallback for email clients that do not render HTML.

    Args:
        voice_name: Display name of the generated voicebank
        preview_url: URL to listen to a preview of the voicebank
        voicebank_url: URL to open the voicebank in the application

    Returns:
        Plain text string for the email body
    """
    return (
        f"Your voicebank is ready!\n"
        f"\n"
        f'"{voice_name}" has finished generating and is ready to use.\n'
        f"\n"
        f"Listen to Preview: {preview_url}\n"
        f"Open Your Voice:   {voicebank_url}\n"
        f"\n"
        f"---\n"
        f"UTAU Voicebank Manager\n"
    )


class NotificationService:
    """Sends email notifications for completed async jobs.

    Uses aiosmtplib for non-blocking SMTP delivery. All errors are
    caught and logged -- callers should never need to handle failures
    from this service.
    """

    def __init__(self, settings: Settings | None = None) -> None:
        """Initialize with application settings.

        Args:
            settings: Application settings. Uses the global singleton
                if not provided.
        """
        self._settings = settings or get_settings()

    async def notify_job_complete(
        self,
        email: str,
        job_id: str,
        voice_name: str,
        preview_url: str,
    ) -> None:
        """Send a job-completion notification email.

        Builds an HTML email with plain-text fallback and sends it
        via the configured SMTP server. Failures are logged and
        swallowed so that a notification error never fails the job.

        Args:
            email: Recipient email address
            job_id: UUID string of the completed job
            voice_name: Display name of the generated voicebank
            preview_url: URL to the voicebank preview audio
        """
        settings = self._settings
        base_url = settings.base_url.rstrip("/")
        voicebank_url = f"{base_url}/jobs/{job_id}/result"

        # Build multipart message
        msg = EmailMessage()
        msg["Subject"] = f'Your voicebank "{voice_name}" is ready'
        msg["From"] = settings.smtp_from
        msg["To"] = email

        plain = _build_plain_body(voice_name, preview_url, voicebank_url)
        html = _build_html_body(voice_name, preview_url, voicebank_url)

        msg.set_content(plain)
        msg.add_alternative(html, subtype="html")

        try:
            await aiosmtplib.send(
                msg,
                hostname=settings.smtp_host,
                port=settings.smtp_port,
                username=settings.smtp_user or None,
                password=settings.smtp_password or None,
                start_tls=settings.smtp_tls,
            )
            logger.info(
                "Sent job-completion notification for job %s to %s",
                job_id,
                email,
            )
        except Exception:
            logger.exception(
                "Failed to send notification email for job %s to %s",
                job_id,
                email,
            )
