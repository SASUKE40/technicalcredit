package app;

import java.util.List;

interface Notifier {
  void send(String recipient, String subject, String text);
}

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
}

public class EmailNotifier implements Notifier {
  private final AcmeMailClient client;

  public EmailNotifier(AcmeMailClient client) {
    this.client = client;
  }

  @Override
  public void send(String recipient, String subject, String text) {
    String html = "<p>" + text.replace("\n", "<br>") + "</p>";
    int status = client.submit(new AcmeMessage(List.of(recipient), subject, html));
    if (status >= 300) {
      throw new IllegalStateException("Mail rejected with status " + status);
    }
  }
}
