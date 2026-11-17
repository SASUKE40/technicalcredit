package app;

import java.util.List;

final class AcmeMessage {
  final List<String> to;
  final String title;
  final String html;

  AcmeMessage(List<String> to, String title, String html) {
    this.to = to;
    this.title = title;
    this.html = html;
  }
}

class AcmeMailClient {
  int submit(AcmeMessage message) {
    return message.to.isEmpty() ? 400 : 202;
  }

  int cancel(String messageId) {
    return messageId.isEmpty() ? 404 : 200;
  }
}

public class EmailSender {
  private final AcmeMailClient client;

  public EmailSender(AcmeMailClient client) {
    this.client = client;
  }

  public int submit(AcmeMessage message) {
    return client.submit(message);
  }

  public int cancel(String messageId) {
    return client.cancel(messageId);
  }
}
