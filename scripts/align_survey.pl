#!/usr/bin/perl
# align_survey.pl — READ-ONLY. Runs the pronoun-aware alignment across ALL OT
# books and reports resolve-% + flag-% per book, so we can see which books'
# versification lines up with Rahlfs (safe to correct) and which don't.
# Usage: perl scripts/align_survey.pl <abp_ot_dir> <rahlfs_dir>
use strict; use warnings; use utf8; binmode(STDOUT, ":utf8");

my ($ABPDIR,$RDIR)=@ARGV;

my %EGO    = map {$_=>1} qw(1473 1700 1698 1691 3165 3427 3450);
my %HEMEIS = map {$_=>1} qw(2249 2257 2254 2248);
my %SU     = map {$_=>1} qw(4771 4675 4671 4571 4674);
my %HUMEIS = map {$_=>1} qw(5210 5216 5213 5209);
my %RESOLVE= (%EGO,%HEMEIS,%SU,%HUMEIS,'846'=>1);
sub base{my$s=shift//'';$s=~s/\s//g;$s=~s/^G//;$s=~s/\..*$//;$s}

# ABP file  => [Marvel-versification booknum, label]
# Marvel versification = 39 protocanonical books in standard English order
# (reverse-engineered from chapter/verse counts), NOT the deuterocanon list.
my @BOOKS = (
  ["abp_genesis.txt",1,"Gen"],      ["abp_exodus.txt",2,"Exo"],
  ["abp_leviticus.txt",3,"Lev"],    ["abp_numbers.txt",4,"Num"],
  ["abp_deuteronomy.txt",5,"Deu"],  ["abp_joshua.txt",6,"Jos"],
  ["abp_judges.txt",7,"Jdg"],       ["abp_ruth.txt",8,"Rth"],
  ["abp_1samuel.txt",9,"1Sa"],      ["abp_2samuel.txt",10,"2Sa"],
  ["abp_1kings.txt",11,"1Ki"],      ["abp_2kings.txt",12,"2Ki"],
  ["abp_1chronicles.txt",13,"1Ch"], ["abp_2chronicles.txt",14,"2Ch"],
  ["abp_ezra.txt",15,"Ezr"],        ["abp_nehemiah.txt",16,"Neh"],
  ["abp_esther.txt",17,"Est"],      ["abp_job.txt",18,"Job"],
  ["abp_psalms.txt",19,"Psa"],      ["abp_proverbs.txt",20,"Pro"],
  ["abp_ecclesiastes.txt",21,"Ecc"],["abp_songofsolomon.txt",22,"Son"],
  ["abp_isaiah.txt",23,"Isa"],      ["abp_jeremiah.txt",24,"Jer"],
  ["abp_lamentations.txt",25,"Lam"],["abp_ezekiel.txt",26,"Eze"],
  ["abp_daniel.txt",27,"Dan"],
  ["abp_hosea.txt",28,"Hos"],       ["abp_joel.txt",29,"Joe"],
  ["abp_amos.txt",30,"Amo"],        ["abp_obadiah.txt",31,"Oba"],
  ["abp_jonah.txt",32,"Jon"],       ["abp_micah.txt",33,"Mic"],
  ["abp_nahum.txt",34,"Nah"],       ["abp_habakkuk.txt",35,"Hab"],
  ["abp_zephaniah.txt",36,"Zep"],   ["abp_haggai.txt",37,"Hag"],
  ["abp_zechariah.txt",38,"Zec"],   ["abp_malachi.txt",39,"Mal"],
);

# ── load Rahlfs once ──
sub load_col{my($p,$c)=@_;my%h;open(my$f,"<:encoding(UTF-8)",$p)or die"$p: $!";
  while(<$f>){my@x=split/\t/,$_;next unless @x&&$x[0]=~/^\d+$/;my$v=$x[$c]//'';$v=~s/\r//g;$h{$x[0]}=$v}close$f;\%h}
my $S=load_col("$RDIR/07_StrongNumber/final_Strongs.csv",1);
my $M=load_col("$RDIR/03a_morphology_with_JTauber_patches/patched_623693.csv",1);
# verse ranges
my @ent;open(my$VF,"<:encoding(UTF-8)","$RDIR/12-Marvel.Bible/00-versification_original.csv")or die$!;
while(<$VF>){my@p=split/\t/;next unless @p>=2;(my$r=$p[1])=~s/^\x{2020}//;next unless $r=~/^(\d+)\.(\d+)\.(\d+)/;push@ent,[$p[0]+0,$1+0,$2+0,$3+0]}close$VF;
my %RANGE;for my$i(0..$#ent){my$e=$i<$#ent?$ent[$i+1][0]-1:$ent[$i][0];$RANGE{"$ent[$i][1]:$ent[$i][2]:$ent[$i][3]"}=[$ent[$i][0],$e]}

sub align{my($a,$b,$bp)=@_;my$n=@$a;my$m=@$b;my(@D,@T);
  for my$i(0..$n){$D[$i][0]=$i*-2;$T[$i][0]=1}for my$j(0..$m){$D[0][$j]=$j*-2;$T[0][$j]=2}
  for my$i(1..$n){my$ai=$a->[$i-1];for my$j(1..$m){my$bj=$b->[$j-1];
    my$eq=(($ai ne''&&$ai ne'*'&&$ai eq$bj)||($ai eq'1473'&&$bp->[$j-1]));
    my$d=$D[$i-1][$j-1]+($eq?3:-1);my$u=$D[$i-1][$j]-2;my$l=$D[$i][$j-1]-2;
    if($d>=$u&&$d>=$l){$D[$i][$j]=$d;$T[$i][$j]=0}elsif($u>=$l){$D[$i][$j]=$u;$T[$i][$j]=1}else{$D[$i][$j]=$l;$T[$i][$j]=2}}}
  my@pr;my$i=$n;my$j=$m;while($i>0||$j>0){my$t=$T[$i][$j];
    if($t==0){unshift@pr,[$i-1,$j-1];$i--;$j--}elsif($t==1){unshift@pr,[$i-1,-1];$i--}else{unshift@pr,[-1,$j-1];$j--}}\@pr}

printf "%-12s %7s %8s %7s   %s\n","book","G1473","resolved","flag%","verdict";
printf "%s\n","-"x60;
for my $bk (@BOOKS){
  my($file,$bnum,$label)=@$bk;
  my $path="$ABPDIR/$file";
  unless(-e $path){printf "%-12s   (file not found: %s)\n",$label,$file;next}
  my($n1473,$flag)=(0,0);
  open(my$AF,"<:encoding(UTF-8)",$path)or next;
  while(<$AF>){next unless /^\((\w+)\s+(\d+):(\d+)\)\s+(.*)/;my($ch,$vs,$txt)=($2,$3,$4);
    my@abp;while($txt=~/(G\*|G\d+(?:\.\d+)*)/g){push@abp,base($1)}
    my$rng=$RANGE{"$bnum:$ch:$vs"};
    my(@rb,@rp);if($rng){for my$k($rng->[0]..$rng->[1]){push@rb,base($S->{$k});my$mo=$M->{$k}//'';push@rp,($mo=~/^R(?!A)/?1:0)}}
    my%amap;if(@rb){my$pr=align(\@abp,\@rb,\@rp);for(@$pr){$amap{$_->[0]}=$_->[1] if $_->[0]>=0}}
    for my$idx(0..$#abp){next unless $abp[$idx]eq'1473';$n1473++;
      my$bj=exists$amap{$idx}?$amap{$idx}:-1;my$rt=($bj>=0&&@rb)?$rb[$bj]:undef;
      $flag++ unless(defined$rt && $RESOLVE{$rt})}
  }close$AF;
  next unless $n1473;
  my$res=$n1473-$flag;my$fp=100*$flag/$n1473;
  my$verdict=$fp<=12?"CLEAN":$fp<=30?"check":"BAD versification";
  printf "%-12s %7d %8d %6.1f%%   %s\n",$label,$n1473,$res,$fp,$verdict;
}
