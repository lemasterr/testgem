# Path: python-core/notify_worker.py
import requests


def send_telegram_msg(token: str, chat_id: str, text: str):
    if not token or not chat_id:
        return "Skipped: credentials missing"

    url = f"https://api.telegram.org/bot{token}/sendMessage"
    try:
        resp = requests.post(url, json={"chat_id": chat_id, "text": text}, timeout=10)
        resp.raise_for_status()
        return "Message sent"
    except Exception as e:
        return f"Error sending message: {str(e)}"


def send_summary(token: str, chat_id: str, summary: dict):
    """
    Формує гарний звіт про роботу пайплайна.
    """
    lines = ["📊 **Sora Pipeline Report**", ""]

    if "sessions" in summary:
        lines.append(f"Sessions Active: {summary['sessions']}")

    if "downloaded" in summary:
        lines.append(f"📥 Downloaded: {summary['downloaded']}")

    if "errors" in summary and summary["errors"] > 0:
        lines.append(f"❌ Errors: {summary['errors']}")
    else:
        lines.append("✅ No errors")

    text = "\n".join(lines)
    return send_telegram_msg(token, chat_id, text)


def send_batch_notifications(token: str, chat_ids: list, text: str):
    """
    Відправляє повідомлення одразу декільком користувачам.
    """
    results = []
    for chat_id in chat_ids:
        result = send_telegram_msg(token, chat_id, text)
        results.append({"chat_id": chat_id, "result": result})
    return results