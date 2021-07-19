---
subject: "Your Couchers.org account has been deleted"
---

{% from "macros.html" import button %}
Hi {{ user.name|couchers_escape }},

You have successfully deleted your account from Couchers.org.

We are sad to see you go, but wish you the best in your future travels. You are always welcome back to the Couchers.org platform anytime :)

If you change your mind, you have 48 hours to retrieve your account by clicking the following link and following the prompts:

{% if html %}

{{ button("Recover Account", recovery_link) }}

Alternatively, click the following link: <{{ recovery_link }}>.

{% else %}

<{{ recovery_link }}>

{% endif %}

After 48 hours, your account will be permanently irretrievable.


If you did not make this request, please contact us by emailing {% if html %}<a href="mailto:support@couchers.org">support@couchers.org</a>{% else %}<support@couchers.org>{% endif %} so we can sort this out as soon as possible!

The Couchers.org team