.method private enforceNonFullscreen()V
    .locals 3
    invoke-virtual {p0}, Lxyz/chatboxapp/chatbox/MainActivity;->getWindow()Landroid/view/Window;
    move-result-object v0
    const/16 v1, 0x400
    invoke-virtual {v0, v1}, Landroid/view/Window;->clearFlags(I)V
    const/4 v1, 0x1
    invoke-static {v0, v1}, Landroidx/core/view/WindowCompat;->setDecorFitsSystemWindows(Landroid/view/Window;Z)V
    invoke-virtual {v0}, Landroid/view/Window;->getDecorView()Landroid/view/View;
    move-result-object v1
    const/4 v2, 0x0
    invoke-virtual {v1, v2}, Landroid/view/View;->setSystemUiVisibility(I)V
    new-instance v2, Landroidx/core/view/WindowInsetsControllerCompat;
    invoke-direct {v2, v0, v1}, Landroidx/core/view/WindowInsetsControllerCompat;-><init>(Landroid/view/Window;Landroid/view/View;)V
    invoke-static {}, Landroidx/core/view/WindowInsetsCompat$Type;->systemBars()I
    move-result v0
    invoke-virtual {v2, v0}, Landroidx/core/view/WindowInsetsControllerCompat;->show(I)V
    return-void
.end method

# Call enforceNonFullscreen() after BridgeActivity.onCreate(), and again from
# onWindowFocusChanged(true), as applied in the decoded APK wrapper.
