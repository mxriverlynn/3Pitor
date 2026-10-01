class Threepitor < Formula
  desc "Markdown blog-post editor with Claude built in"
  homepage "https://github.com/mxriverlynn/3Pitor"

  depends_on macos: :ventura

  on_macos do
    on_arm do
      url "https://github.com/mxriverlynn/3Pitor/releases/download/v0.0.0/3pitor-0.0.0-darwin-arm64.tar.gz"
      sha256 "0000000000000000000000000000000000000000000000000000000000000000"
    end
    on_intel do
      url "https://github.com/mxriverlynn/3Pitor/releases/download/v0.0.0/3pitor-0.0.0-darwin-x86_64.tar.gz"
      sha256 "0000000000000000000000000000000000000000000000000000000000000000"
    end
  end

  def install
    bin.install "3pitor"
  end

  def caveats
    <<~EOS
      3pitor's chat needs ANTHROPIC_API_KEY set, or the claude program installed and signed in.
    EOS
  end

  test do
    assert_equal "3pitor #{version}\n", shell_output("#{bin}/3pitor --version")
    system "codesign", "--verify", "--strict", bin/"3pitor"
  end
end
