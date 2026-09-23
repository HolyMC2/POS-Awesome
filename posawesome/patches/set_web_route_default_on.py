"""Historical patch retained for patch-log compatibility.

The route preference was retired by remove_web_route_setting. Fresh sites
must not recreate it or rewrite profile data while replaying this patch.
"""


def execute():
    pass
